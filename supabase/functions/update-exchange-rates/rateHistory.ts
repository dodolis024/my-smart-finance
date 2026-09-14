// @ts-nocheck
// 匯率歷史的純日期函式，抽出以便單元測試（無 Deno 專屬相依，可於 vitest/Node 直接匯入）。
// 由 index.ts 匯入使用。

// 歷史匯率永久保留、不做清理：歷史一旦刪掉就補不回來（API 的歷史端點要付費），
// 而成本可以忽略——12 種幣別一年約 4,400 列、兩三百 KB，
// 相對 Supabase 免費額度的 500 MB 要上千年才會成為問題。

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

