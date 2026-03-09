// Supabase Edge Function: 每日簽到提醒
// 此函數每小時由 pg_cron 觸發，檢查哪些用戶需要收到提醒 email
// 根據用戶設定的時區與提醒時間，對當天尚未簽到的用戶發送提醒信

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
    const resendApiKey = Deno.env.get('RESEND_API_KEY')

    if (!resendApiKey) {
      throw new Error('RESEND_API_KEY not configured')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 1. 取得所有啟用提醒的用戶設定
    const { data: reminderUsers, error: settingsError } = await supabase
      .from('settings')
      .select('user_id, value')
      .eq('key', 'reminder_settings')

    if (settingsError) {
      throw new Error(`Failed to fetch reminder settings: ${settingsError.message}`)
    }

    if (!reminderUsers || reminderUsers.length === 0) {
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

    const now = new Date()
    const emailsSent: string[] = []
    const errors: { userId: string; error: string }[] = []

    for (const setting of reminderUsers) {
      const config = setting.value as {
        enabled: boolean
        timezone: string
        time: string
      }

      // 跳過未啟用的用戶
      if (!config.enabled) continue

      // 2. 檢查現在是否為該用戶的提醒時刻（±30 分鐘容差）
      const userTimezone = config.timezone || 'Asia/Taipei'
      const reminderTime = config.time || '20:00'

      if (!isReminderTime(now, userTimezone, reminderTime)) {
        continue
      }

      // 3. 取得該用戶時區的「今天」日期
      const userToday = getUserToday(now, userTimezone)

      // 4. 檢查今天是否已簽到
      const { data: checkinData } = await supabase
        .from('checkins')
        .select('id')
        .eq('user_id', setting.user_id)
        .eq('date', userToday)
        .limit(1)

      if (checkinData && checkinData.length > 0) {
        console.log(`User ${setting.user_id} already checked in today (${userToday}), skipping`)
        continue
      }

      // 5. 取得用戶 email
      const { data: userData, error: userError } = await supabase.auth.admin.getUserById(
        setting.user_id
      )

      if (userError || !userData?.user?.email) {
        console.error(`Failed to get email for user ${setting.user_id}:`, userError?.message)
        errors.push({ userId: setting.user_id, error: userError?.message || 'No email found' })
        continue
      }

      const userEmail = userData.user.email

      // 6. 發送提醒 email
      try {
        const emailResult = await sendReminderEmail(resendApiKey, userEmail)
        if (emailResult.success) {
          emailsSent.push(setting.user_id)
          console.log(`Reminder email sent to ${userEmail}`)
        } else {
          console.error(`Failed to send email to ${userEmail}:`, emailResult.error)
          errors.push({ userId: setting.user_id, error: emailResult.error || 'Send failed' })
        }
      } catch (emailError) {
        console.error(`Error sending email to ${userEmail}:`, emailError.message)
        errors.push({ userId: setting.user_id, error: emailError.message })
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
 * 判斷現在是否為該用戶的提醒時刻（±30 分鐘容差）
 * 因為 cron 每小時跑一次，容差設為 30 分鐘確保不漏發
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

    // 處理跨午夜的情況（例如 23:50 vs 00:10）
    const wrappedDiff = Math.min(diff, 1440 - diff)

    return wrappedDiff <= 30
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

/**
 * 透過 Resend API 發送提醒 email
 */
async function sendReminderEmail(
  apiKey: string,
  to: string
): Promise<{ success: boolean; error?: string }> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Smart Finance <noreply@smartfinance.app>',
      to: [to],
      subject: '你今天還沒記帳喔！別讓連續紀錄中斷了 🔥',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem;">
          <h2 style="color: #333; margin-bottom: 1rem;">嗨！提醒你記帳喔 ✨</h2>
          <p style="color: #666; line-height: 1.6; font-size: 1rem;">
            今天還沒有記帳或簽到，你的連續記帳紀錄快要中斷了！
          </p>
          <p style="color: #666; line-height: 1.6; font-size: 1rem;">
            花一分鐘記錄今天的花費，或者按一下「今日無消費」來維持你的 streak 吧！
          </p>
          <div style="margin-top: 1.5rem;">
            <a href="https://your-app-url.com"
               style="display: inline-block; padding: 0.75rem 1.5rem; background: #6366f1; color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">
              前往記帳
            </a>
          </div>
          <p style="color: #999; font-size: 0.8rem; margin-top: 2rem;">
            你可以在 Smart Finance 的設定中關閉此提醒。
          </p>
        </div>
      `,
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    return { success: false, error: `Resend API error: ${response.status} ${errorBody}` }
  }

  return { success: true }
}
