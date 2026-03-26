// @ts-nocheck
// Supabase Edge Function: 信用卡額度使用率警告推播
// 由前端在交易新增/更新/刪除後以 fire-and-forget 方式呼叫
// 當使用率達到偏高閾值或超額時，透過 Web Push 推播給用戶
// 防重複：同一帳戶同一層級（warn/over），每天各只發一次

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

    const body = await req.json()
    const { user_id, account_id, account_name, usage_rate } = body

    if (!user_id || !account_id || !account_name || usage_rate == null) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 1. 查詢用戶通知設定
    const { data: settingsRows } = await supabase
      .from('settings')
      .select('key, value')
      .eq('user_id', user_id)
      .in('key', ['credit_card_notification_settings', 'credit_card_usage_alert_last_sent'])

    const notifSettings: Record<string, unknown> = {}
    let lastSentMap: Record<string, { warn?: string; over?: string }> = {}

    for (const row of (settingsRows || [])) {
      if (row.key === 'credit_card_notification_settings') Object.assign(notifSettings, row.value)
      if (row.key === 'credit_card_usage_alert_last_sent') lastSentMap = row.value || {}
    }

    // 跳過未啟用使用率警告的用戶
    if (notifSettings.usage_alert_enabled === false) {
      return new Response(
        JSON.stringify({ success: true, skipped: 'usage_alert_disabled' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const warnThreshold = (notifSettings.usage_warn_threshold as number) ?? 80
    const usagePct = usage_rate * 100

    // 判斷通知層級
    const isOver = usagePct >= 100
    const isWarn = !isOver && usagePct >= warnThreshold

    if (!isOver && !isWarn) {
      return new Response(
        JSON.stringify({ success: true, skipped: 'below_threshold' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const level = isOver ? 'over' : 'warn'

    // 2. 防重複：同一帳戶同一層級，今天已發過
    const now = new Date()
    const todayStr = getUTCPlus8Today(now)
    const accountLastSent = lastSentMap[account_id] || {}
    if (accountLastSent[level] === todayStr) {
      return new Response(
        JSON.stringify({ success: true, skipped: 'already_sent_today' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 3. 查詢 push_subscriptions
    const { data: subscriptions } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_id', user_id)

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(
        JSON.stringify({ success: true, skipped: 'no_subscriptions' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 4. 組合通知文字
    const pctStr = Math.round(usagePct)
    const notifyBody = isOver
      ? `「${account_name}」已超過信用額度（${pctStr}%），請注意！`
      : `「${account_name}」使用率已達 ${pctStr}%，接近額度上限`

    const payload = JSON.stringify({
      title: 'Smart Finance',
      body: notifyBody,
      icon: '/my-smart-finance/favicons/web-app-manifest-192x192.png',
      badge: '/my-smart-finance/favicons/favicon-96x96.png',
      url: '/my-smart-finance/',
    })

    const staleEndpoints: string[] = []
    let sent = 0

    for (const sub of subscriptions) {
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
          console.error(`[send-credit-usage-alert] Push failed for ${sub.endpoint}:`, err.message)
        }
      }
    }

    // 清除失效訂閱
    if (staleEndpoints.length > 0) {
      await supabase.from('push_subscriptions').delete().in('endpoint', staleEndpoints)
    }

    // 5. 更新防重複記錄
    const updatedLastSent = {
      ...lastSentMap,
      [account_id]: { ...accountLastSent, [level]: todayStr },
    }
    await supabase
      .from('settings')
      .upsert(
        { user_id, key: 'credit_card_usage_alert_last_sent', value: updatedLastSent },
        { onConflict: 'user_id,key' }
      )

    return new Response(
      JSON.stringify({ success: true, sent }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('[send-credit-usage-alert] Error:', err.message)
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

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
