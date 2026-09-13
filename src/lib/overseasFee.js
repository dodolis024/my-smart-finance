// ⚠️ tools/core/overseasFee.js 有逐字相同的第二份（CLI 無法匯入 src/），改動兩邊都要改，
// 否則網頁與 CLI 會算出不同的手續費。見 tools/README.md「同步義務」。

/** 可以設定海外手續費的帳戶類型 */
export const OVERSEAS_FEE_ACCOUNT_TYPES = ['credit_card', 'debit_card'];

/**
 * 帳戶的海外手續費率（%）。不支援的類型、未設定、非正數一律回 null。
 * 帳戶物件可能來自 RPC（駝峰）或資料表（蛇形），兩種都要吃。
 */
export function getOverseasFeeRate(account) {
  if (!account || !OVERSEAS_FEE_ACCOUNT_TYPES.includes(account.type)) return null;
  const raw = account.overseasFeeRate ?? account.overseas_fee_rate;
  if (raw == null || raw === '') return null;
  const rate = Number(raw);
  return rate > 0 ? rate : null;
}

/** 選外幣時是否預設勾選；欄位不存在（舊快取）視為開，與資料庫預設一致 */
export function getOverseasAutoCheck(account) {
  const raw = account?.overseasFeeAutoCheck ?? account?.overseas_fee_auto_check;
  return raw !== false;
}

/** 記帳表單／CLI 在使用者沒有明確表態時的預設勾選狀態 */
export function defaultOverseasChecked(account, currency, type) {
  if (type === 'income') return false;
  if (getOverseasFeeRate(account) == null) return false;
  if (!getOverseasAutoCheck(account)) return false;
  return String(currency || '').trim().toUpperCase() !== 'TWD';
}

/**
 * 原幣金額 → 台幣本體、手續費、合計。
 * 捨入方式不可更動（與既有 twd_amount 算法相同：乘 100 後 Math.round 再除 100）。
 * feeRate 為 null 或非正數時，overseasFee 為 null（代表非海外消費，不是 0）。
 */
export function computeTwdWithFee(amount, exchangeRate, feeRate) {
  const baseTwd = Math.round(amount * exchangeRate * 100) / 100;
  if (!(Number(feeRate) > 0)) {
    return { baseTwd, overseasFee: null, twdAmount: baseTwd };
  }
  // baseTwd × feeRate% 取到分：baseTwd * feeRate / 100 * 100 = baseTwd * feeRate
  const overseasFee = Math.round(baseTwd * Number(feeRate)) / 100;
  const twdAmount = Math.round((baseTwd + overseasFee) * 100) / 100;
  return { baseTwd, overseasFee, twdAmount };
}
