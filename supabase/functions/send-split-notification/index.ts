// @ts-nocheck
// Supabase Edge Function: 分帳群組推播通知
// 由前端 hook 在 mutation 完成後以 fire-and-forget 方式呼叫
// 查詢群組成員的 push_subscriptions，透過 Web Push 推送通知

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import webpush from 'npm:web-push'
import { splitNotifyBody } from '../_shared/notificationTexts.ts'
import { decideSplitNotification } from './decide.ts'
import { getUserLangs } from '../_shared/userLang.ts'

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

    // 驗證呼叫者身分：以 JWT 為準，不信任 request body 傳入的 actor_user_id
    const authHeader = req.headers.get('Authorization') ?? ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '')
    const { data: authData, error: authError } = await supabase.auth.getUser(jwt)
    if (authError || !authData?.user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    const actor_user_id = authData.user.id

    const body = await req.json()
    const {
      event,
      group_id,
      expense_id,
      settlement_id,
      member_id,
    } = body

    if (!event || !group_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 確認呼叫者是該群組的已連結成員或擁有者；群組與操作者名稱以資料庫為準
    const { data: actorMember } = await supabase
      .from('split_members')
      .select('name, split_groups ( name )')
      .eq('group_id', group_id)
      .eq('user_id', actor_user_id)
      .maybeSingle()

    let actor_name = actorMember?.name ?? ''
    let group_name = actorMember?.split_groups?.name ?? ''

    if (!actorMember) {
      // 擁有者可能已把自己從成員名單移除，退回用 owner 身分驗證
      const { data: ownedGroup } = await supabase
        .from('split_groups')
        .select('name')
        .eq('id', group_id)
        .eq('owner_id', actor_user_id)
        .maybeSingle()

      if (!ownedGroup) {
        return new Response(
          JSON.stringify({ success: false, error: 'Not a member of this group' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      group_name = ownedGroup.name
      // 擁有者已退出成員名單時資料庫查不到名字，只能用傳入值（decide.ts 會消毒、限長）
      actor_name = body.actor_name
    }

    // 文案只用資料庫查得到的紀錄組，呼叫端傳的標題、金額、幣別、還款雙方一律不用。
    // 每次查詢都綁 group_id，否則可拿別的群組的紀錄來組通知。
    let expense = null
    if ((event === 'expense_added' || event === 'expense_updated') && typeof expense_id === 'string') {
      const { data } = await supabase
        .from('split_expenses')
        .select('title, amount, currency, created_at')
        .eq('id', expense_id)
        .eq('group_id', group_id)
        .maybeSingle()
      expense = data ?? null
    }

    let settlement = null
    let fromName = ''
    let toName = ''
    if (event === 'settlement_added' && typeof settlement_id === 'string') {
      const { data } = await supabase
        .from('split_settlements')
        .select('amount, currency, from_member, to_member, created_at')
        .eq('id', settlement_id)
        .eq('group_id', group_id)
        .maybeSingle()
      settlement = data ?? null
      if (settlement) {
        const { data: parties } = await supabase
          .from('split_members')
          .select('id, name')
          .eq('group_id', group_id)
          .in('id', [settlement.from_member, settlement.to_member])
        const nameById = new Map((parties ?? []).map((m) => [m.id, m.name]))
        fromName = nameById.get(settlement.from_member) ?? ''
        toName = nameById.get(settlement.to_member) ?? ''
      }
    }

    // member_added 查得到就用資料庫的名字；member_removed 的來源列已不在，只能用傳入值
    let memberName = body.member_name
    if (typeof member_id === 'string') {
      const { data: member } = await supabase
        .from('split_members')
        .select('name')
        .eq('id', member_id)
        .eq('group_id', group_id)
        .maybeSingle()
      if (member) memberName = member.name
    }

    const decision = decideSplitNotification({
      event,
      now: new Date(),
      actorName: actor_name,
      groupName: group_name,
      expense,
      settlement,
      fromName,
      toName,
      memberName,
    })

    if (!decision.send) {
      // 查不到紀錄或紀錄不是剛建立的：不送，也不算錯（前端與 CLI 都是 fire-and-forget）
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: decision.reason }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 組合通知文字（依收件者語言，預組兩份）
    const bodyByLang = {
      zh: splitNotifyBody(event, 'zh', decision.params),
      en: splitNotifyBody(event, 'en', decision.params),
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
    const langs = await getUserLangs(supabase, userIds)

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

    const payloadByLang = {
      zh: JSON.stringify({
        title: 'Smart Finance',
        body: bodyByLang.zh,
        icon: '/my-smart-finance/favicons/web-app-manifest-192x192.png',
        badge: '/my-smart-finance/favicons/favicon-96x96.png',
        url: '/my-smart-finance/',
      }),
      en: JSON.stringify({
        title: 'Smart Finance',
        body: bodyByLang.en,
        icon: '/my-smart-finance/favicons/web-app-manifest-192x192.png',
        badge: '/my-smart-finance/favicons/favicon-96x96.png',
        url: '/my-smart-finance/',
      }),
    }

    let sent = 0
    let failed = 0
    const staleEndpoints: string[] = []

    for (const sub of subscriptions) {
      try {
        const payload = payloadByLang[langs.get(sub.user_id) ?? 'zh']
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
