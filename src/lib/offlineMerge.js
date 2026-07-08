/**
 * 離線佇列 → 儀表板畫面的純合併邏輯（React 接線在 useOfflineMergedView）。
 */

/**
 * 把佇列項目轉成交易列格式（僅保留指定年月），標記 pending 供 UI 顯示。
 * failed = 補送失敗需手動重試，UI 以危險色標記並顯示失敗原因。
 */
export function buildQueuedRows(queuedItems, year, month) {
  if (queuedItems.length === 0) return [];
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
  return queuedItems
    .filter((item) => String(item.tx?.date || '').startsWith(monthPrefix))
    .map((item) => ({
      id: item.tx.id,
      date: item.tx.date,
      type: item.tx.type,
      category: item.tx.category,
      itemName: item.tx.item_name,
      paymentMethod: item.tx.payment_method,
      currency: item.tx.currency,
      amount: item.tx.amount,
      twdAmount: item.tx.twd_amount,
      note: item.tx.note,
      pending: true,
      queueStatus: item.status,
      queueError: item.errorMessage,
    }));
}

/**
 * 佇列交易併入交易列表，依日期新→舊排序。
 */
export function mergeQueuedIntoHistory(history, queuedRows) {
  if (queuedRows.length === 0) return history;
  return [...queuedRows, ...history].sort((a, b) =>
    String(b.date).localeCompare(String(a.date))
  );
}

/**
 * 佇列交易的收支併入當月彙總。
 */
export function mergeQueuedIntoSummary(summary, queuedRows) {
  if (queuedRows.length === 0) return summary;
  let dIncome = 0;
  let dExpense = 0;
  for (const row of queuedRows) {
    const amt = typeof row.twdAmount === 'number' ? row.twdAmount : 0;
    if (row.type === 'income') dIncome += amt;
    else dExpense += amt;
  }
  return {
    ...summary,
    totalIncome: summary.totalIncome + dIncome,
    totalExpense: summary.totalExpense + dExpense,
    balance: summary.balance + dIncome - dExpense,
  };
}
