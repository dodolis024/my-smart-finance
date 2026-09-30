/**
 * 支付工具（帳戶）的顯示順序。
 *
 * 順序沒有放進 accounts 資料表，而是比照類別存成 settings 的一列（key: account_order，
 * value: 帳戶 id 陣列）：不必改資料表與 get_dashboard_data，排序純在前端套用，
 * CLI 那份實作也不受影響。
 *
 * 存 id 而不是名稱：帳戶改名後順序仍然跟著同一個帳戶。
 */

export const ACCOUNT_ORDER_KEY = 'account_order';

/**
 * 依使用者排好的順序排列帳戶。
 *
 * 沒被排到的帳戶（排序之後才新增的）接在最後面，彼此維持原本的順序——
 * 資料來源本來就按 created_at，所以新帳戶會照建立順序排在尾端。
 *
 * @param {Array} accounts 帳戶清單（RPC 或資料表格式皆可）
 * @param {Array} order    帳戶 id 陣列，非陣列或空陣列時原封不動回傳
 */
export function sortAccountsByOrder(accounts, order) {
  if (!Array.isArray(accounts) || !Array.isArray(order) || order.length === 0) return accounts;
  const rank = new Map(order.map((id, index) => [String(id), index]));
  // Array.prototype.sort 是穩定排序，兩者都沒被排到時回傳 0 即維持原順序
  return [...accounts].sort((a, b) => {
    const rankA = rank.get(String(a.id)) ?? Infinity;
    const rankB = rank.get(String(b.id)) ?? Infinity;
    // 兩者都沒被排到時必須先擋掉：Infinity - Infinity 是 NaN，會讓排序結果不可預測
    if (rankA === rankB) return 0;
    return rankA - rankB;
  });
}
