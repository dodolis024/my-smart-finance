/**
 * 帳戶的啟用狀態。
 *
 * 剪卡、關戶之後帳戶改為「停用」而不是刪除：過去的交易、統計、搜尋全部保留，
 * 只是不再出現在記帳表單、訂閱、餘額面板這些「之後還會用到帳戶」的地方。
 *
 * 帳戶物件有兩種來源：get_dashboard_data 回傳駝峰（isActive），直接查 accounts 表是蛇形
 * （is_active）。欄位不存在（migration 還沒跑、舊快取）一律視為啟用，行為與加欄位之前相同。
 */
export function isAccountActive(account) {
  if (!account) return false;
  const value = account.isActive ?? account.is_active;
  return value == null ? true : Boolean(value);
}

export function activeAccounts(accounts) {
  return (accounts || []).filter(isAccountActive);
}
