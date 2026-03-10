// @ts-nocheck
// Supabase Edge Function: 訂閱自動建立交易
// 此函數每天由 pg_cron 觸發，檢查哪些訂閱今天到期，並自動建立交易紀錄
// 防重複機制：新增前先確認當月是否已有來自同一 subscription_id 的交易

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

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

    const now = new Date()
    const year = now.getUTCFullYear()
    const month = now.getUTCMonth() + 1
    const today = now.getUTCDate()

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

    for (const sub of subscriptions) {
      try {
        const actualDay = getActualDay(sub.renewal_day, year, month)

        // 不是今天到期的跳過
        if (actualDay !== today) continue

        const dateStr = `${year}-${monthStr}-${String(actualDay).padStart(2, '0')}`

        // 防重複：確認本月是否已建立過此訂閱的交易
        const { data: existing } = await supabase
          .from('transactions')
          .select('id')
          .eq('subscription_id', sub.id)
          .gte('date', monthStart)
          .lte('date', monthEnd)
          .limit(1)

        if (existing && existing.length > 0) {
          console.log(`Subscription ${sub.id} already has transaction for ${year}-${monthStr}, skipping`)
          continue
        }

        // 取得匯率（失敗則預設 1）
        let exchangeRate = 1
        if (sub.currency && sub.currency !== 'TWD') {
          const { data: rateVal } = await supabase.rpc('get_exchange_rate', {
            p_currency: sub.currency.toUpperCase(),
          })
          if (rateVal && rateVal > 0) exchangeRate = Number(rateVal)
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

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed subscriptions. Transactions created: ${created.length}`,
        timestamp: new Date().toISOString(),
        transactionsCreated: created.length,
        errors: errors.length > 0 ? errors : undefined,
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
