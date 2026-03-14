// @ts-nocheck
// Supabase Edge Function: 每日簽到提醒
// 此函數每 5 分鐘由 pg_cron 觸發，檢查哪些用戶需要收到提醒 email
// 根據用戶設定的時區與提醒時間，對當天尚未簽到的用戶發送提醒信
// 使用 Brevo Transactional Email API 發信
// 防重複機制：使用獨立的 reminder_last_sent 紀錄追蹤每日寄信狀態

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

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

    // 1. 一次撈出所有 reminder_settings 和 reminder_last_sent 紀錄
    const { data: allSettings, error: settingsError } = await supabase
      .from('settings')
      .select('user_id, key, value')
      .in('key', ['reminder_settings', 'reminder_last_sent'])

    if (settingsError) {
      throw new Error(`Failed to fetch settings: ${settingsError.message}`)
    }

    if (!allSettings || allSettings.length === 0) {
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

    // 2. 按 user_id 分組：把 config 和 lastSentDate 整理到一起
    const userMap = new Map<string, {
      config?: { enabled: boolean; timezone: string; time: string }
      lastSentDate?: string
    }>()

    for (const row of allSettings) {
      if (!userMap.has(row.user_id)) userMap.set(row.user_id, {})
      const entry = userMap.get(row.user_id)!
      if (row.key === 'reminder_settings') {
        entry.config = row.value as { enabled: boolean; timezone: string; time: string }
      }
      if (row.key === 'reminder_last_sent') {
        entry.lastSentDate = (row.value as { date?: string })?.date
      }
    }

    const now = new Date()
    const emailsSent: string[] = []
    const errors: { userId: string; error: string }[] = []

    // 收集需要發信的用戶（含 userToday，供寄信後更新用）
    const usersToNotify: { userId: string; email: string; userToday: string }[] = []

    for (const [userId, { config, lastSentDate }] of userMap) {
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

      // 5. 防重複：如果今天已經寄過，跳過
      if (lastSentDate === userToday) {
        console.log(`User ${userId} already received reminder for ${userToday}, skipping duplicate`)
        continue
      }

      // 6. 檢查今天是否已簽到（已簽到就不需要提醒）
      const { data: checkinData } = await supabase
        .from('checkins')
        .select('id')
        .eq('user_id', userId)
        .eq('date', userToday)
        .limit(1)

      if (checkinData && checkinData.length > 0) {
        console.log(`User ${userId} already checked in today (${userToday}), skipping`)
        continue
      }

      // 7. 取得用戶 email
      const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId)

      if (userError || !userData?.user?.email) {
        console.error(`Failed to get email for user ${userId}:`, userError?.message)
        errors.push({ userId, error: userError?.message || 'No email found' })
        continue
      }

      usersToNotify.push({ userId, email: userData.user.email, userToday })
    }

    // 8. 如果有需要通知的用戶，透過 Brevo API 發信
    const emailHtml = buildEmailHtml()
    for (const { userId, email, userToday } of usersToNotify) {
      try {
        const res = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'api-key': brevoApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sender: { name: 'My Smart Finance', email: 'dorischen0910224@gmail.com' },
            to: [{ email }],
            subject: '你今天還沒記帳喔！別讓連續紀錄中斷了 🔥',
            htmlContent: emailHtml,
          }),
        })

        if (!res.ok) {
          const errBody = await res.text()
          throw new Error(`Brevo API error ${res.status}: ${errBody}`)
        }

        // 寄信成功 → 寫入 reminder_last_sent 防止重複
        await supabase
          .from('settings')
          .upsert(
            { user_id: userId, key: 'reminder_last_sent', value: { date: userToday } },
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

/**
 * 組合 email HTML 內容
 */
function buildEmailHtml(): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem;">
      <h2 style="color: #333; margin-bottom: 1rem;">哈嚕！你的提醒已抵達 ✨</h2>
      <p style="color: #666; line-height: 1.6; font-size: 1rem;">
        你今天還迷有記帳或簽到，再不快點紀錄就要中斷了！
      </p>
      <p style="color: #666; line-height: 1.6; font-size: 1rem;">
        快去紀錄今天的花費，或者按一下 Check-in Button 來維持你的 streak 吧～！
      </p>
      <div style="margin-top: 1.5rem;">
        <a href="https://dodolis024.github.io/my-smart-finance/"
           style="display: inline-block; padding: 0.75rem 1.5rem; background: #b59c80; color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">
          前往記帳
        </a>
      </div>
      <p style="color: #999; font-size: 0.8rem; margin-top: 2rem;">
        你可以在 My Smart Finance 的 更多->簽到提醒 關閉此提醒。
      </p>
    </div>
  `
}

/**
 * 判斷現在是否為該用戶的提醒時刻（±2 分鐘容差）
 * cron 每 5 分鐘跑一次，用戶最小設定單位也是 5 分鐘，
 * 所以 ±2 分鐘保證每個 target 只被一次 cron 命中，不會重複觸發
 */
function isReminderTime(now: Date, timezone: string, reminderTime: string): boolean {
  try {
    // 取得用戶時區的當前時間
    const userNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }))
    const userHour = userNow.getHours()
    const userMinute = userNow.getMinutes()

    // 解析設定的提醒時間
    const [targetHour, targetMinute] = reminderTime.split(':').map(Number)

    // 計算分鐘差距
    const currentMinutes = userHour * 60 + userMinute
    const targetMinutes = targetHour * 60 + targetMinute
    const diff = Math.abs(currentMinutes - targetMinutes)

    // 處理跨午夜的情況（例如 23:58 vs 00:00）
    const wrappedDiff = Math.min(diff, 1440 - diff)

    return wrappedDiff <= 2
  } catch {
    console.error(`Invalid timezone: ${timezone}`)
    return false
  }
}

/**
 * 取得用戶時區的「今天」日期（YYYY-MM-DD 格式）
 */
function getUserToday(now: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
    return parts // en-CA 格式自動為 YYYY-MM-DD
  } catch {
    // Fallback 到台灣時區
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
    return parts
  }
}
