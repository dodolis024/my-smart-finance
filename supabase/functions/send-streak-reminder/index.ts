// @ts-nocheck
// Supabase Edge Function: 每日簽到提醒
// 此函數每小時由 pg_cron 觸發，檢查哪些用戶需要收到提醒 email
// 根據用戶設定的時區與提醒時間，對當天尚未簽到的用戶發送提醒信
// 使用 Gmail SMTP 發信（透過 App Password 驗證）

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts"

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
    const gmailUser = Deno.env.get('GMAIL_USER')
    const gmailAppPassword = Deno.env.get('GMAIL_APP_PASSWORD')

    if (!gmailUser || !gmailAppPassword) {
      throw new Error('GMAIL_USER or GMAIL_APP_PASSWORD not configured')
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

    // 收集需要發信的用戶
    const usersToNotify: { userId: string; email: string }[] = []

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

      usersToNotify.push({ userId: setting.user_id, email: userData.user.email })
    }

    // 6. 如果有需要通知的用戶，建立 SMTP 連線並發信
    if (usersToNotify.length > 0) {
      const client = new SMTPClient({
        connection: {
          hostname: 'smtp.gmail.com',
          port: 465,
          tls: true,
          auth: {
            username: gmailUser,
            password: gmailAppPassword,
          },
        },
      })

      for (const { userId, email } of usersToNotify) {
        try {
          await client.send({
            from: gmailUser,
            to: email,
            subject: '你今天還沒記帳喔！別讓連續紀錄中斷了 🔥',
            content: '你今天還迷有記帳或簽到，再不快點紀錄就要中斷了！花一分鐘記錄今天的花費，或者按一下 Check-in Button 來維持你的 streak 吧～！',
            html: buildEmailHtml(),
          })
          emailsSent.push(userId)
          console.log(`Reminder email sent to ${email}`)
        } catch (emailError) {
          console.error(`Error sending email to ${email}:`, emailError.message)
          errors.push({ userId, error: emailError.message })
        }
      }

      await client.close()
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
        花一分鐘記錄今天的花費，或者按一下 Check-in Button 來維持你的 streak 吧～！
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
