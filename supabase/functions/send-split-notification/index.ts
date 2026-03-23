// @ts-nocheck
// Supabase Edge Function: 分帳群組推播通知
// 由前端 hook 在 mutation 完成後以 fire-and-forget 方式呼叫
// 查詢群組成員的 push_subscriptions，透過 Web Push 推送通知

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
    const {
      event,
      group_id,
      group_name,
      actor_name,
      actor_user_id,
      expense_title,
      expense_amount,
      currency,
      member_name,
      from_name,
      to_name,
    } = body

    if (!event || !group_id || !actor_user_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 組合通知文字
    const amountStr = expense_amount != null ? ` ${currency || 'TWD'} ${expense_amount}` : ''
    let notifyBody = ''
    switch (event) {
      case 'expense_added':
        notifyBody = `${actor_name} 在「${group_name}」新增了費用「${expense_title}」${amountStr}`
        break
      case 'expense_updated':
        notifyBody = `${actor_name} 更新了費用「${expense_title}」`
        break
      case 'expense_deleted':
        notifyBody = `${actor_name} 刪除了費用「${expense_title}」`
        break
      case 'member_added':
        notifyBody = `${actor_name} 將「${member_name}」加入了「${group_name}」`
        break
      case 'member_removed':
        notifyBody = `「${member_name}」已從「${group_name}」被移除`
        break
      case 'settlement_added':
        notifyBody = `${actor_name} 記錄了「${from_name}」→「${to_name}」的還款 ${currency || 'TWD'} ${expense_amount}`
        break
      default:
        notifyBody = `${group_name} 有新的異動`
    }

    // 查詢群組內有 user_id 的成員，排除操作者本人
    const { data: members, error: membersError } = await supabase
      .from('split_members')
      .select('user_id')
      .eq('group_id', group_id)
      .not('user_id', 'is', null)
      .neq('user_id', actor_user_id)

    if (membersError) throw new Error(`Failed to fetch members: ${membersError.message}`)

    if (!members || members.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, failed: 0, message: 'No other members to notify' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const userIds = members.map((m) => m.user_id)

    // 查詢這些 user_id 的所有 push_subscriptions
    const { data: subscriptions, error: subsError } = await supabase
      .from('push_subscriptions')
      .select('user_id, endpoint, p256dh, auth')
      .in('user_id', userIds)

    if (subsError) throw new Error(`Failed to fetch subscriptions: ${subsError.message}`)

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, failed: 0, message: 'No push subscriptions found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const payload = JSON.stringify({
      title: 'Smart Finance',
      body: notifyBody,
      icon: '/my-smart-finance/favicons/web-app-manifest-192x192.png',
      badge: '/my-smart-finance/favicons/favicon-96x96.png',
      url: '/my-smart-finance/',
    })

    let sent = 0
    let failed = 0
    const staleEndpoints: string[] = []

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        )
        sent++
      } catch (err) {
        failed++
        // 410 Gone 或 404 = 訂閱已失效，標記後清除
        if (err.statusCode === 410 || err.statusCode === 404) {
          staleEndpoints.push(sub.endpoint)
        } else {
          console.error(`[send-split-notification] Push failed for endpoint ${sub.endpoint}:`, err.message)
        }
      }
    }

    // 清除失效訂閱
    if (staleEndpoints.length > 0) {
      await supabase
        .from('push_subscriptions')
        .delete()
        .in('endpoint', staleEndpoints)
      console.log(`[send-split-notification] Removed ${staleEndpoints.length} stale subscription(s)`)
    }

    return new Response(
      JSON.stringify({ success: true, sent, failed }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('[send-split-notification] Error:', err.message)
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
