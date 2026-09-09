// @ts-nocheck
// 匯率歷史的純日期函式，抽出以便單元測試（無 Deno 專屬相依，可於 vitest/Node 直接匯入）。
// 由 index.ts 匯入使用。

/**
 * 歷史匯率保留天數。
 *
 * 一年多一點，撐得住「去年同期」的比較。成本可以忽略：12 種幣別 × 400 天
 * 約 4,800 列、250 KB 上下，相對 Supabase 免費額度的 500 MB 是萬分之五。
 * 保留期沒有技術上限，訂在這裡純粹是「累積得夠久」與「表不要無限長」的折衷。
 */
export const RETENTION_DAYS = 400

/**
 * 取 UTC 的日期字串（YYYY-MM-DD）。
 *
 * 一律用 UTC 而不是任何當地時區：cron 排在 UTC 02:00，用 UTC 日期才保證
 * 「一天剛好一列」。換成當地時區，跨日那一刻前後兩次執行會落在不同日期，
 * 表裡就會出現一天兩列、或某天整天沒有的洞。
 *
 * 代價是使用者當地看到的日期可能與表裡差一天。這可以接受：查詢一律是
 * 「往前找最近一筆」（見 get_exchange_rate_on），差一天取到的是前一日匯率，
 * 而不是查不到。
 */
export function utcDateString(now: Date): string {
  return now.toISOString().slice(0, 10)
}

/**
 * 保留期的界線日期（YYYY-MM-DD）：**早於**這天的歷史可以刪。
 *
 * 界線當天本身保留，所以實際留存是 RETENTION_DAYS + 1 天。以毫秒做減法而非
 * 逐月推算，UTC 沒有日光節約，不會有「減一個月碰到不存在的日期」那類問題。
 */
export function retentionCutoff(now: Date, days: number = RETENTION_DAYS): string {
  return utcDateString(new Date(now.getTime() - days * 24 * 60 * 60 * 1000))
}
