// @ts-nocheck
// Supabase Edge Function: 每日簽到提醒
// 此函數每 5 分鐘由 pg_cron 觸發，檢查哪些用戶需要收到提醒 email
// 根據用戶設定的時區與提醒時間，對當天尚未簽到的用戶發送提醒信
// 使用 Brevo Transactional Email API 發信
// 防重複機制：使用獨立的 reminder_last_sent 紀錄追蹤每日寄信狀態

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { isReminderTime, getUserToday } from './reminderTime.ts'
import { streakEmailSubject, streakEmailHtml } from '../_shared/notificationTexts.ts'
import { getUserLangs } from '../_shared/userLang.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // 處理 CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const brevoApiKey = Deno.env.get('BREVO_API_KEY')

    if (!brevoApiKey) {
      throw new Error('BREVO_API_KEY not configured')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 1. 只撈「已啟用提醒」的 reminder_settings（enabled 在 DB 端以 jsonb 包含過濾，
    //    未啟用／未設定的使用者不進記憶體，避免使用者數成長時整表搬回來再丟掉）
    const { data: enabledSettings, error: settingsError } = await supabase
      .from('settings')
      .select('user_id, value')
      .eq('key', 'reminder_settings')
      .contains('value', { enabled: true })

    if (settingsError) {
      throw new Error(`Failed to fetch settings: ${settingsError.message}`)
    }

    if (!enabledSettings || enabledSettings.length === 0) {
      console.log('No users with reminder settings found')
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No users with reminder settings',
          timestamp: new Date().toISOString(),
          emailsSent: 0,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // 2. 只對啟用中的使用者補查 reminder_last_sent，按 user_id 整理到一起
    const userMap = new Map<string, {
      config?: { enabled: boolean; timezone: string; time: string }
      lastSentDate?: string
      lastSentAt?: string
    }>()

    for (const row of enabledSettings) {
      userMap.set(row.user_id, {
        config: row.value as { enabled: boolean; timezone: string; time: string },
      })
    }

    const { data: lastSentRows, error: lastSentError } = await supabase
      .from('settings')
      .select('user_id, value')
      .eq('key', 'reminder_last_sent')
      .in('user_id', [...userMap.keys()])

    if (lastSentError) {
      throw new Error(`Failed to fetch reminder_last_sent: ${lastSentError.message}`)
    }

    for (const row of lastSentRows || []) {
      const entry = userMap.get(row.user_id)
      if (!entry) continue
      const v = row.value as { date?: string; sentAt?: string }
      entry.lastSentDate = v?.date
      entry.lastSentAt = v?.sentAt
    }

    const now = new Date()
    const emailsSent: string[] = []
    const errors: { userId: string; error: string }[] = []

    // 收集需要發信的用戶（含 userToday，供寄信後更新用）
    const usersToNotify: { userId: string; email: string; userToday: string }[] = []

    // 3~5. 純記憶體篩選（不觸及 DB）：挑出「此刻該提醒且未被防重複壓下」的候選用戶。
    //      判斷邏輯（時區比對、±2 分容差、跨時區防重複）維持原樣，僅把後續的 DB 查詢
    //      改為批次，避免用戶數成長時逐一往返而超過 edge function 時限。
    const candidates: { userId: string; userToday: string }[] = []

    for (const [userId, { config, lastSentDate, lastSentAt }] of userMap) {
      // 跳過沒設定或未啟用的用戶
      if (!config?.enabled) continue

      // 3. 檢查現在是否為該用戶的提醒時刻（±2 分鐘容差）
      const userTimezone = config.timezone || 'Asia/Taipei'
      const reminderTime = config.time || '20:00'

      const reminderMatch = isReminderTime(now, userTimezone, reminderTime)
      console.log(`User ${userId} reminderTime=${reminderTime} timezone=${userTimezone} match=${reminderMatch} now=${now.toISOString()}`)
      if (!reminderMatch) {
        continue
      }

      // 4. 取得該用戶時區的「今天」日期
      const userToday = getUserToday(now, userTimezone)

      // 5. 防重複：距上次寄信不到 4 小時就跳過
      //    改用「時間戳」而非「日期字串」比對，避免跨時區旅行時新時區的提醒被錯誤壓下。
      //    例：台北 23:00 寄出後飛抵洛杉磯，當地 23:00 仍屬同一日曆日，但實際相隔 15 小時，
      //    此時應該要再提醒一次。若沿用日期比對，這封提醒會被誤判為重複而漏寄，
      //    使用者便可能整整超過一天沒收到提醒、錯過簽到而中斷 streak。
      //    4 小時門檻：同時區每日相隔 24h 會正常寄出；洲際旅行時差 ≥ 5h 也會寄出；
      //    僅短途旅行（時差 < 4h、剛提醒過）會被壓下。
      if (lastSentAt) {
        const hoursSinceLastSent = (now.getTime() - new Date(lastSentAt).getTime()) / 3_600_000
        if (hoursSinceLastSent < 4) {
          console.log(`User ${userId} received reminder ${hoursSinceLastSent.toFixed(1)}h ago, skipping duplicate`)
          continue
        }
      } else if (lastSentDate === userToday) {
        // 向後相容：舊紀錄沒有 sentAt，退回原本的日期比對
        console.log(`User ${userId} already received reminder for ${userToday} (legacy), skipping duplicate`)
        continue
      }

      candidates.push({ userId, userToday })
    }

    // 6. 批次檢查今天是否已簽到（已簽到就不需要提醒）
    //    一次撈回所有候選用戶的當日簽到，取代逐一 .eq(user_id).eq(date) 往返。
    //    各時區「今天」不同，故 user_id 與 date 都用 IN 收斂；索引 idx_checkins_user_id_date 可命中。
    const checkedInKeys = new Set<string>()
    if (candidates.length > 0) {
      const candidateIds = [...new Set(candidates.map((c) => c.userId))]
      const candidateDates = [...new Set(candidates.map((c) => c.userToday))]
      const { data: checkinRows, error: checkinError } = await supabase
        .from('checkins')
        .select('user_id, date')
        .in('user_id', candidateIds)
        .in('date', candidateDates)

      if (checkinError) {
        throw new Error(`Failed to fetch checkins: ${checkinError.message}`)
      }
      for (const row of checkinRows || []) {
        checkedInKeys.add(`${row.user_id}|${row.date}`)
      }
    }

    // 過濾掉今天已簽到的候選；其餘才需要寄信、需要 email
    const needEmail = candidates.filter((c) => {
      if (checkedInKeys.has(`${c.userId}|${c.userToday}`)) {
        console.log(`User ${c.userId} already checked in today (${c.userToday}), skipping`)
        return false
      }
      return true
    })

    const langs = await getUserLangs(supabase, needEmail.map((c) => c.userId))

    // 7. 批次取得需寄信用戶的 email（一次 RPC 取代逐一 auth.admin.getUserById）
    if (needEmail.length > 0) {
      const emailIds = [...new Set(needEmail.map((c) => c.userId))]
      const { data: emailRows, error: emailError } = await supabase
        .rpc('get_user_emails', { p_user_ids: emailIds })

      if (emailError) {
        throw new Error(`Failed to fetch user emails: ${emailError.message}`)
      }

      const emailMap = new Map<string, string>()
      for (const row of (emailRows as { id: string; email: string | null }[]) || []) {
        if (row.email) emailMap.set(row.id, row.email)
      }

      for (const { userId, userToday } of needEmail) {
        const email = emailMap.get(userId)
        if (!email) {
          console.error(`Failed to get email for user ${userId}`)
          errors.push({ userId, error: 'No email found' })
          continue
        }
        usersToNotify.push({ userId, email, userToday })
      }
    }

    // 8. 如果有需要通知的用戶，透過 Brevo API 發信
    const htmlByLang = { zh: streakEmailHtml('zh'), en: streakEmailHtml('en') }
    const subjectByLang = { zh: streakEmailSubject('zh'), en: streakEmailSubject('en') }
    for (const { userId, email, userToday } of usersToNotify) {
      try {
        const lang = langs.get(userId) ?? 'zh'
        const res = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'api-key': brevoApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sender: { name: 'My Smart Finance', email: 'dorischen0910224@gmail.com' },
            to: [{ email }],
            subject: subjectByLang[lang],
            htmlContent: htmlByLang[lang],
          }),
        })

        if (!res.ok) {
          const errBody = await res.text()
          throw new Error(`Brevo API error ${res.status}: ${errBody}`)
        }

        // 寄信成功 → 寫入 reminder_last_sent 防止重複（含 UTC 時間戳供跨時區判斷）
        await supabase
          .from('settings')
          .upsert(
            { user_id: userId, key: 'reminder_last_sent', value: { date: userToday, sentAt: now.toISOString() } },
            { onConflict: 'user_id,key' }
          )

        emailsSent.push(userId)
        console.log(`Reminder email sent to ${email}`)
      } catch (emailError) {
        console.error(`Error sending email to ${email}:`, emailError.message)
        errors.push({ userId, error: emailError.message })
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed reminder check. Emails sent: ${emailsSent.length}`,
        timestamp: new Date().toISOString(),
        emailsSent: emailsSent.length,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    console.error('Error in send-streak-reminder:', error)

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
