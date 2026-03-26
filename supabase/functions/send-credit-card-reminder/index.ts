// @ts-nocheck
// Supabase Edge Function: 信用卡繳款日提醒推播
// 由 pg_cron 每日定時觸發，檢查哪些用戶的信用卡即將到繳款日
// 透過 Web Push 推播提醒（使用現有 push_subscriptions 表）
// 防重複機制：settings 表 key='credit_card_reminder_last_sent' 記錄各帳戶當日是否已發

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import webpush from 'npm:web-push'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
    const vapidSubject = Deno.env.get('VAPID_SUBJECT')

    if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
      throw new Error('VAPID secrets not configured')
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 1. 撈出所有信用卡帳戶
    const { data: creditCards, error: cardsError } = await supabase
      .from('accounts')
      .select('id, user_id, name, payment_due_day')
      .eq('type', 'credit_card')
      .not('payment_due_day', 'is', null)

    if (cardsError) throw new Error(`Failed to fetch credit card accounts: ${cardsError.message}`)
    if (!creditCards || creditCards.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No credit card accounts found', sent: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 2. 取出有信用卡的 user_id 清單，撈出他們的通知設定與防重複記錄
    const userIds = [...new Set(creditCards.map((c) => c.user_id))]

    const { data: allSettings, error: settingsError } = await supabase
      .from('settings')
      .select('user_id, key, value')
      .in('user_id', userIds)
      .in('key', ['credit_card_notification_settings', 'credit_card_reminder_last_sent'])

    if (settingsError) throw new Error(`Failed to fetch settings: ${settingsError.message}`)

    // 按 user_id 整理設定
    const userSettingsMap = new Map<string, {
      notifSettings?: { payment_reminder_enabled?: boolean; payment_days_before?: number }
      lastSent?: Record<string, string>
    }>()

    for (const row of (allSettings || [])) {
      if (!userSettingsMap.has(row.user_id)) userSettingsMap.set(row.user_id, {})
      const entry = userSettingsMap.get(row.user_id)!
      if (row.key === 'credit_card_notification_settings') entry.notifSettings = row.value
      if (row.key === 'credit_card_reminder_last_sent') entry.lastSent = row.value
    }

    const now = new Date()
    const todayStr = getUTCPlus8Today(now) // 以台灣時間為基準計算「今天」

    let totalSent = 0
    const updatedLastSent: Map<string, Record<string, string>> = new Map()

    for (const card of creditCards) {
      const userId = card.user_id
      const userEntry = userSettingsMap.get(userId) || {}
      const notifSettings = userEntry.notifSettings || {}

      // 跳過未啟用繳款日提醒的用戶
      if (notifSettings.payment_reminder_enabled === false) continue

      const daysBefore = notifSettings.payment_days_before ?? 3
      const dueDay = card.payment_due_day as number

      // 計算今天距繳款日的天數
      const daysUntilDue = getDaysUntilDay(dueDay, now)
      const shouldNotify = daysUntilDue === 0 || daysUntilDue === daysBefore

      if (!shouldNotify) continue

      // 防重複：今天已發過這張卡的提醒
      const lastSentForUser = updatedLastSent.get(userId) ?? { ...(userEntry.lastSent || {}) }
      const lastSentKey = `${card.id}_${daysUntilDue === 0 ? 'due' : 'before'}`
      if (lastSentForUser[lastSentKey] === todayStr) continue

      // 查詢該用戶的 push_subscriptions
      const { data: subscriptions } = await supabase
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .eq('user_id', userId)

      if (!subscriptions || subscriptions.length === 0) continue

      // 組合通知文字
      const notifyTitle = 'Smart Finance'
      const notifyBody = daysUntilDue === 0
        ? `「${card.name}」今天是繳款日，記得繳清！`
        : `「${card.name}」還有 ${daysUntilDue} 天到繳款日`

      const payload = JSON.stringify({
        title: notifyTitle,
        body: notifyBody,
        icon: '/my-smart-finance/favicons/web-app-manifest-192x192.png',
        badge: '/my-smart-finance/favicons/favicon-96x96.png',
        url: '/my-smart-finance/',
      })

      const staleEndpoints: string[] = []
      for (const sub of subscriptions) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          )
          totalSent++
        } catch (err) {
          if (err.statusCode === 410 || err.statusCode === 404) {
            staleEndpoints.push(sub.endpoint)
          } else {
            console.error(`[send-credit-card-reminder] Push failed for ${sub.endpoint}:`, err.message)
          }
        }
      }

      // 清除失效訂閱
      if (staleEndpoints.length > 0) {
        await supabase.from('push_subscriptions').delete().in('endpoint', staleEndpoints)
      }

      // 更新防重複記錄
      lastSentForUser[lastSentKey] = todayStr
      updatedLastSent.set(userId, lastSentForUser)
    }

    // 批量寫回防重複記錄
    for (const [userId, lastSentValue] of updatedLastSent) {
      await supabase
        .from('settings')
        .upsert(
          { user_id: userId, key: 'credit_card_reminder_last_sent', value: lastSentValue },
          { onConflict: 'user_id,key' }
        )
    }

    return new Response(
      JSON.stringify({ success: true, sent: totalSent, timestamp: now.toISOString() }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('[send-credit-card-reminder] Error:', err.message)
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

/**
 * 計算距離指定日（每月幾日）還有幾天（0 = 今天就是）
 * 以台灣時間（UTC+8）為基準
 */
function getDaysUntilDay(day: number, now: Date): number {
  const tw = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  const year = tw.getUTCFullYear()
  const month = tw.getUTCMonth() + 1 // 1-based
  const today = tw.getUTCDate()

  // 今月的目標日
  const daysInMonth = new Date(year, month, 0).getDate()
  const targetDay = Math.min(day, daysInMonth)

  if (today <= targetDay) {
    return targetDay - today
  }
  // 目標日在下個月
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  const daysInNextMonth = new Date(nextYear, nextMonth, 0).getDate()
  const nextTargetDay = Math.min(day, daysInNextMonth)
  const daysToEndOfMonth = daysInMonth - today
  return daysToEndOfMonth + nextTargetDay
}

/**
 * 取得台灣時間（UTC+8）的今日日期字串 YYYY-MM-DD
 */
function getUTCPlus8Today(now: Date): string {
  const utcMs = now.getTime()
  const offset = 8 * 60 * 60 * 1000
  const tw = new Date(utcMs + offset)
  const y = tw.getUTCFullYear()
  const m = String(tw.getUTCMonth() + 1).padStart(2, '0')
  const d = String(tw.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
