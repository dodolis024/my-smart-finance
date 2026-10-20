// 瀏覽器裡那份匯率表（offlineCache 的 saveRates／loadRates）什麼時候算過期。
//
// 資料庫的匯率由排程每天 02:00 UTC（台灣 10:00）更新一次（pg_cron update-exchange-rates-daily），
// 上游 exchangerate-api 本身也是一天一更。以前前端固定存 24 小時：台灣 9:55 存下的表要到隔天
// 9:55 才換，但資料庫 10:00 就更新了，畫面會比資料庫晚一整天、比市場晚將近兩天。
// 改成「存檔時間早於最近一次排程更新」就算過期：更新後第一次開頁就重抓，最壞只跟資料庫一樣新。
//
// 這裡只管「要不要重抓」。真正寫進資料庫的金額都不吃這份快取：記帳用交易當天的歷史匯率、
// 結清按下去時現抓、離線補送時重算。

const DAY_MS = 24 * 60 * 60 * 1000;
export const RATE_UPDATE_UTC_HOUR = 2;
/** 排程 02:00 起跑，函式抓 API、寫表要幾秒到幾十秒；多留 10 分鐘，太早重抓只會拿到舊表 */
export const RATE_UPDATE_SLACK_MS = 10 * 60 * 1000;
/** 資料庫的匯率超過這麼多天沒更新就在首頁提示：排程曾經壞掉 53 天沒人發現 */
export const RATES_STALE_WARN_DAYS = 3;

/** 最近一次「排程應已跑完」的時間點（ms）：今天 02:10 UTC，還沒到就算昨天的 */
export function lastRateUpdateAt(now = Date.now()) {
  const d = new Date(now);
  const todayBoundary = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), RATE_UPDATE_UTC_HOUR)
    + RATE_UPDATE_SLACK_MS;
  return now >= todayBoundary ? todayBoundary : todayBoundary - DAY_MS;
}

/** 下一次「排程應已跑完」的時間點（ms） */
export function nextRateUpdateAt(now = Date.now()) {
  return lastRateUpdateAt(now) + DAY_MS;
}

/**
 * @param {number} savedAt 匯率表存下的時間（ms）；沒存過是 0
 * @param {number} now
 */
export function ratesStale(savedAt, now = Date.now()) {
  if (!(savedAt > 0)) return true;
  // 裝置時鐘被往回調（存檔時間在未來）就當過期，寧可多抓一次也不要抱著對不上的時間
  if (savedAt > now) return true;
  return savedAt < lastRateUpdateAt(now);
}

/**
 * 畫面整天開著、沒切走也沒重整時，visibilitychange 不會觸發；在下一次排程更新的時間點
 * 叫一次 cb。回傳取消函式。cb 自己要再判斷要不要抓（ratesStale），這裡只負責叫醒。
 */
export function scheduleAtNextRateUpdate(cb, now = Date.now()) {
  // 至少隔 1 秒，避免時鐘誤差讓它在邊界上連續觸發
  const delay = Math.max(1000, nextRateUpdateAt(now) - now);
  const id = setTimeout(cb, delay);
  return () => clearTimeout(id);
}

/**
 * 資料庫的匯率距今幾天沒更新（整數天，無條件捨去）；讀不到時間回 null。
 * @param {string|number|Date|null} updatedAt exchange_rates 最新的 updated_at
 */
export function daysSinceRateUpdate(updatedAt, now = Date.now()) {
  if (updatedAt == null) return null;
  const ts = new Date(updatedAt).getTime();
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, Math.floor((now - ts) / DAY_MS));
}
