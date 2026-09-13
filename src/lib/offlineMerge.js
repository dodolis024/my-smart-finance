/**
 * 離線佇列 → 儀表板畫面的純合併邏輯（React 接線在 useOfflineMergedView）。
 */

/**
 * 把佇列項目轉成交易列格式（僅保留日期區間內、含端點），標記 pending 供 UI 顯示。
 * failed = 補送失敗需手動重試，UI 以危險色標記並顯示失敗原因。
 * @param {Array} queuedItems
 * @param {string} startDate 'YYYY-MM-DD'
 * @param {string} endDate   'YYYY-MM-DD'
 */
export function buildQueuedRows(queuedItems, startDate, endDate) {
  if (queuedItems.length === 0) return [];
  return queuedItems
    .filter((item) => {
      // 'YYYY-MM-DD' 是定長格式，字串比較即等同日期比較
      const d = String(item.tx?.date || '');
      return d >= startDate && d <= endDate;
    })
    .map((item) => ({
      id: item.tx.id,
      date: item.tx.date,
      time: item.tx.time,
      type: item.tx.type,
      category: item.tx.category,
      itemName: item.tx.item_name,
      paymentMethod: item.tx.payment_method,
      currency: item.tx.currency,
      amount: item.tx.amount,
      twdAmount: item.tx.twd_amount,
      overseasFeeRate: item.tx.overseas_fee_rate ?? null,
      overseasFee: item.tx.overseas_fee ?? null,
      note: item.tx.note,
      pending: true,
      queueStatus: item.status,
      queueError: item.errorMessage,
    }));
}

/**
 * 佇列交易併入交易列表，依日期＋時間新→舊排序（與 get_dashboard_data 的排序邏輯一致）。
 */
export function mergeQueuedIntoHistory(history, queuedRows) {
  if (queuedRows.length === 0) return history;
  return [...queuedRows, ...history].sort((a, b) => {
    const dateDiff = String(b.date).localeCompare(String(a.date));
    if (dateDiff !== 0) return dateDiff;
    return String(b.time || '').localeCompare(String(a.time || ''));
  });
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
