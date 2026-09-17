// @ts-nocheck
// 訂閱扣款日的純日期函式，抽出以便單元測試（無 Deno 專屬相依，可於 vitest/Node 直接匯入）。
// 由 index.ts 匯入使用。

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000

const pad2 = (n: number) => String(n).padStart(2, '0')

/** 計算指定年月的實際天數 */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

/**
 * 以台灣時間（UTC+8）拆出「今天」的年月日與時分。
 *
 * 排程跑在 UTC：直接用 UTC 日期，扣款日與交易日期會提早一天；
 * 交易不帶 time 的話資料庫會用它自己的 UTC 時鐘，慢 8 小時。
 */
export function taipeiClock(now: Date): { year: number; month: number; day: number; time: string } {
  const tw = new Date(now.getTime() + TAIPEI_OFFSET_MS)
  return {
    year: tw.getUTCFullYear(),
    month: tw.getUTCMonth() + 1,
    day: tw.getUTCDate(),
    time: `${pad2(tw.getUTCHours())}:${pad2(tw.getUTCMinutes())}`,
  }
}

/**
 * 訂閱今天該不該扣款：該扣就回傳交易日期（YYYY-MM-DD），不該扣回傳 null。
 *
 * - 年繳只在 renewal_month 那個月扣；缺 renewal_month 的由呼叫端先擋下回報錯誤，這裡一律不扣
 * - renewal_day 超過當月天數（例如 31 號遇到 4 月、2/29 遇到平年）改在月底扣，不跳過
 */
export function chargeDateToday(
  sub: { billing_cycle?: string | null; renewal_day: number; renewal_month?: number | null },
  clock: { year: number; month: number; day: number }
): string | null {
  const { year, month, day } = clock
  if ((sub.billing_cycle || 'monthly') === 'yearly' && sub.renewal_month !== month) return null

  const actualDay = Math.min(sub.renewal_day, daysInMonth(year, month))
  if (actualDay !== day) return null

  return `${year}-${pad2(month)}-${pad2(actualDay)}`
}

/** 防重複的查詢區間：月繳查本月、年繳查本年是否已建立過這個訂閱的交易 */
export function dedupeRange(cycle: string, year: number, month: number): { start: string; end: string } {
  if (cycle === 'yearly') return { start: `${year}-01-01`, end: `${year}-12-31` }
  return {
    start: `${year}-${pad2(month)}-01`,
    end: `${year}-${pad2(month)}-${pad2(daysInMonth(year, month))}`,
  }
}
