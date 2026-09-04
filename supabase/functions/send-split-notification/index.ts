// @ts-nocheck
// Supabase Edge Function: 分帳群組推播通知
// 由前端 hook 在 mutation 完成後以 fire-and-forget 方式呼叫
// 查詢群組成員的 push_subscriptions，透過 Web Push 推送通知

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import webpush from 'npm:web-push'
import { splitNotifyBody, sanitizeNotifyText } from '../_shared/notificationTexts.ts'
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
      member_id,
      from_member,
      to_member,
    } = body

    // 呼叫端給的顯示字串一律先消毒:這些欄位只在查不到來源時才會被用上
    // (刪除類事件的名稱,以及尚未帶識別碼的舊版前端/CLI)
    const expense_title = sanitizeNotifyText(body.expense_title)
    const member_name = sanitizeNotifyText(body.member_name)
    const from_name = sanitizeNotifyText(body.from_name)
    const to_name = sanitizeNotifyText(body.to_name)
    const currency = sanitizeNotifyText(body.currency)
    const expense_amount = typeof body.expense_amount === 'number' ? body.expense_amount : null

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
      // 擁有者已退出成員名單時資料庫查不到名字,只能用傳入值,同樣要消毒
      actor_name = sanitizeNotifyText(body.actor_name)
    }

    // 能查證的一律以資料庫為準,呼叫端傳的同名欄位只在查不到時才頂上。
    // 刪除類事件(expense_deleted/member_removed)的來源列已不存在,只能沿用消毒後的傳入值。
    // 每次查詢都綁 group_id,否則可拿別的群組的名稱來組通知。
    let resolvedTitle = expense_title
    let resolvedAmount = expense_amount
    let resolvedCurrency = currency
    let resolvedMemberName = member_name
    let resolvedFromName = from_name
    let resolvedToName = to_name

    if (expense_id) {
      const { data: expense } = await supabase
        .from('split_expenses')
        .select('title, amount, currency')
        .eq('id', expense_id)
        .eq('group_id', group_id)
        .maybeSingle()
      if (expense) {
        resolvedTitle = sanitizeNotifyText(expense.title)
        resolvedAmount = expense.amount
        resolvedCurrency = sanitizeNotifyText(expense.currency)
      }
    }

    const memberIds = [member_id, from_member, to_member].filter(Boolean)
    if (memberIds.length > 0) {
      const { data: namedMembers } = await supabase
        .from('split_members')
        .select('id, name')
        .eq('group_id', group_id)
        .in('id', memberIds)
      const nameById = new Map((namedMembers ?? []).map((m) => [m.id, sanitizeNotifyText(m.name)]))
      if (nameById.has(member_id)) resolvedMemberName = nameById.get(member_id)
      if (nameById.has(from_member)) resolvedFromName = nameById.get(from_member)
      if (nameById.has(to_member)) resolvedToName = nameById.get(to_member)
    }

    // 組合通知文字（依收件者語言，預組兩份）
    const amountStr = resolvedAmount != null ? ` ${resolvedCurrency || 'TWD'} ${resolvedAmount}` : ''
    const textParams = {
      actorName: actor_name,
      groupName: group_name,
      expenseTitle: resolvedTitle,
      memberName: resolvedMemberName,
      fromName: resolvedFromName,
      toName: resolvedToName,
      amountStr,
      currency: resolvedCurrency,
      expenseAmount: resolvedAmount,
    }
    const bodyByLang = {
      zh: splitNotifyBody(event, 'zh', textParams),
      en: splitNotifyBody(event, 'en', textParams),
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
