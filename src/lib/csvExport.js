/**
 * 交易列表 → CSV（RFC 4180）。
 * - 開頭加 UTF-8 BOM，Excel 開繁中不亂碼。
 * - 換行用 CRLF。
 * - 欄位含逗號/雙引號/換行時以雙引號包裹，內部雙引號加倍。
 * - 金額輸出原始數值（不加千分位），方便 Excel 直接運算。
 */

export function csvEscape(value) {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * @param {Array} rows 駝峰形狀的交易列（displayHistory 或搜尋結果）
 * @param {{ headers: string[], typeLabels: { expense: string, income: string } }} labels
 *   headers 順序固定：日期、類型、分類、項目、支付方式、幣別、金額、台幣金額、備註
 */
export function buildTransactionsCsv(rows, { headers, typeLabels }) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    // RPC 列是 originalAmount、離線佇列列是 amount，兩種都要吃
    const amount =
      row.originalAmount != null ? row.originalAmount
      : row.amount != null ? row.amount
      : '';
    lines.push(
      [
        row.date,
        typeLabels[row.type] ?? row.type ?? '',
        row.category,
        row.itemName,
        row.paymentMethod,
        row.currency,
        amount,
        row.twdAmount,
        row.note,
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** 下載模式沿用 useCardExport.js:53-60（createObjectURL → <a download> → revoke）。 */
export function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
