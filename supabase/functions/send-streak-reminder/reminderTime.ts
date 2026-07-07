// @ts-nocheck
// 時區相關的純函式，抽出以便單元測試（無 Deno 專屬相依，可於 vitest/Node 直接匯入）。
// 由 index.ts 匯入使用，內容與原先定義於 index.ts 的版本一致。

/**
 * 判斷現在是否為該用戶的提醒時刻（±2 分鐘容差）
 * cron 每 5 分鐘跑一次，用戶最小設定單位也是 5 分鐘，
 * 所以 ±2 分鐘保證每個 target 只被一次 cron 命中，不會重複觸發
 */
export function isReminderTime(now: Date, timezone: string, reminderTime: string): boolean {
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
export function getUserToday(now: Date, timezone: string): string {
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
