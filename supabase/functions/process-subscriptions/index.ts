// @ts-nocheck
// Supabase Edge Function: 訂閱自動建立交易
// 此函數每天由 pg_cron 觸發，檢查哪些訂閱今天到期，並自動建立交易紀錄
// 防重複機制：新增前先確認是否已有來自同一 subscription_id 的交易
//   - 月繳（billing_cycle = 'monthly'）：檢查當月範圍
//   - 年繳（billing_cycle = 'yearly'）：檢查當年範圍

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import webpush from 'npm:web-push'
import { subscriptionRateSkipBody } from '../_shared/notificationTexts.ts'
import { getUserLangs } from '../_shared/userLang.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/** 計算指定年月的實際天數 */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

/** 將用戶設定的 renewal_day 轉換為當月的實際日期（處理月底邊界） */
function getActualDay(renewalDay: number, year: number, month: number): number {
  return Math.min(renewalDay, daysInMonth(year, month))
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 以台灣時間（UTC+8）為基準計算「今天」，避免 UTC 使扣款日與交易日期提早一天
    const now = new Date()
    const tw = new Date(now.getTime() + 8 * 60 * 60 * 1000)
    const year = tw.getUTCFullYear()
    const month = tw.getUTCMonth() + 1
    const today = tw.getUTCDate()

    const monthStr = String(month).padStart(2, '0')
    const monthStart = `${year}-${monthStr}-01`
    const monthEnd = `${year}-${monthStr}-${daysInMonth(year, month)}`

    // 撈出所有啟用中的訂閱
    const { data: subscriptions, error: subError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('is_active', true)

    if (subError) throw new Error(`Failed to fetch subscriptions: ${subError.message}`)

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No active subscriptions', transactionsCreated: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    const created: string[] = []
    const errors: { subscriptionId: string; error: string }[] = []
    // 因缺匯率被跳過的訂閱：主迴圈結束後批次推播提醒擁有者手動記帳
    const rateSkipped: { userId: string; subName: string; currency: string }[] = []

    for (const sub of subscriptions) {
      try {
        const cycle = sub.billing_cycle || 'monthly'

        // 年繳：僅在指定月份扣款
        if (cycle === 'yearly') {
          if (!sub.renewal_month) {
            errors.push({ subscriptionId: sub.id, error: 'yearly subscription missing renewal_month' })
            continue
          }
          if (month !== sub.renewal_month) continue
        }

        const actualDay = getActualDay(sub.renewal_day, year, month)

        // 不是今天到期的跳過
        if (actualDay !== today) continue

        const dateStr = `${year}-${monthStr}-${String(actualDay).padStart(2, '0')}`

        // 防重複：月繳查本月、年繳查本年是否已建立過此訂閱的交易
        const rangeStart = cycle === 'yearly' ? `${year}-01-01` : monthStart
        const rangeEnd = cycle === 'yearly' ? `${year}-12-31` : monthEnd
        const { data: existing } = await supabase
          .from('transactions')
          .select('id')
          .eq('subscription_id', sub.id)
          .gte('date', rangeStart)
          .lte('date', rangeEnd)
          .limit(1)

        if (existing && existing.length > 0) {
          console.log(`Subscription ${sub.id} already has transaction for ${cycle === 'yearly' ? year : `${year}-${monthStr}`}, skipping`)
          continue
        }

        // 取得匯率；查無匯率時跳過該筆，避免外幣被靜默以 1:1 記成錯誤的台幣金額
        // 取捨：當天跳過後該期扣款不補建，寧缺勿錯（需手動補記）
        let exchangeRate = 1
        if (sub.currency && sub.currency !== 'TWD') {
          const { data: rateVal, error: rateErr } = await supabase.rpc('get_exchange_rate', {
            p_currency: sub.currency.toUpperCase(),
          })
          if (rateErr || rateVal == null || Number(rateVal) <= 0) {
            errors.push({ subscriptionId: sub.id, error: `no exchange rate for ${sub.currency}` })
            rateSkipped.push({ userId: sub.user_id, subName: sub.name, currency: sub.currency.toUpperCase() })
            continue
          }
          exchangeRate = Number(rateVal)
        }
        const twdAmount = Math.round(sub.amount * exchangeRate * 100) / 100

        // 查詢 account_id
        let accountId = null
        if (sub.payment_method) {
          const { data: account } = await supabase
            .from('accounts')
            .select('id')
            .eq('name', sub.payment_method)
            .eq('user_id', sub.user_id)
            .single()
          accountId = account?.id || null
        }

        // 建立交易
        const { error: txError } = await supabase
          .from('transactions')
          .insert({
            user_id: sub.user_id,
            date: dateStr,
            type: 'expense',
            item_name: sub.name,
            category: sub.category || '其他',
            payment_method: sub.payment_method || null,
            account_id: accountId,
            currency: sub.currency || 'TWD',
            amount: sub.amount,
            exchange_rate: exchangeRate,
            twd_amount: twdAmount,
            subscription_id: sub.id,
          })

        if (txError) throw new Error(txError.message)

        created.push(sub.id)
        console.log(`Created transaction for subscription "${sub.name}" (${sub.id}) on ${dateStr}`)
      } catch (err) {
        console.error(`Error processing subscription ${sub.id}:`, err.message)
        errors.push({ subscriptionId: sub.id, error: err.message })
      }
    }

    // 推播提醒：訂閱因缺匯率被跳過時通知擁有者手動記帳
    // 加值功能，VAPID 未設定或發送失敗都只記錄，不影響已完成的交易建立與回應
    let rateSkipNotified = 0
    if (rateSkipped.length > 0) {
      try {
        rateSkipNotified = await notifyRateSkipped(supabase, rateSkipped)
      } catch (err) {
        console.error('[process-subscriptions] rate-skip push notification failed:', err.message)
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed subscriptions. Transactions created: ${created.length}`,
        timestamp: new Date().toISOString(),
        transactionsCreated: created.length,
        errors: errors.length > 0 ? errors : undefined,
        rateSkipNotified,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    console.error('Error in process-subscriptions:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message, timestamp: new Date().toISOString() }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

/**
 * 訂閱因缺匯率被跳過時，推播提醒擁有者手動記帳（加值功能）
 * VAPID 未設定或個別發送失敗都只記錄，回傳值為實際送達的通知數
 */
async function notifyRateSkipped(
  supabase: any,
  items: { userId: string; subName: string; currency: string }[]
): Promise<number> {
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const vapidSubject = Deno.env.get('VAPID_SUBJECT')

  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    console.error('[process-subscriptions] VAPID secrets not configured, skip rate-skip push')
    return 0
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)

  const userIds = [...new Set(items.map((i) => i.userId))]
  const langs = await getUserLangs(supabase, userIds)

  const { data: subscriptions, error: subsError } = await supabase
    .from('push_subscriptions')
    .select('user_id, endpoint, p256dh, auth')
    .in('user_id', userIds)

  if (subsError) {
    console.error('[process-subscriptions] failed to fetch push_subscriptions:', subsError.message)
    return 0
  }
  if (!subscriptions || subscriptions.length === 0) return 0

  const subsByUser = new Map<string, typeof subscriptions>()
  for (const s of subscriptions) {
    if (!subsByUser.has(s.user_id)) subsByUser.set(s.user_id, [])
    subsByUser.get(s.user_id)!.push(s)
  }

  let sent = 0
  const staleEndpoints: string[] = []

  for (const item of items) {
    const userSubs = subsByUser.get(item.userId)
    if (!userSubs || userSubs.length === 0) continue

    const lang = langs.get(item.userId) ?? 'zh'
    const payload = JSON.stringify({
      title: 'Smart Finance',
      body: subscriptionRateSkipBody(lang, item.subName, item.currency),
      icon: '/my-smart-finance/favicons/web-app-manifest-192x192.png',
      badge: '/my-smart-finance/favicons/favicon-96x96.png',
      url: '/my-smart-finance/',
    })

    for (const sub of userSubs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        )
        sent++
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          staleEndpoints.push(sub.endpoint)
        } else {
          console.error(`[process-subscriptions] Push failed for ${sub.endpoint}:`, err.message)
        }
      }
    }
  }

  if (staleEndpoints.length > 0) {
    await supabase.from('push_subscriptions').delete().in('endpoint', staleEndpoints)
  }

  return sent
}
