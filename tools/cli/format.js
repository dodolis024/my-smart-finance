/** 中文字在終端機佔兩格，用 padEnd 對齊會歪掉，所以要自己算顯示寬度 */
function displayWidth(text) {
  let width = 0;
  for (const char of String(text)) {
    // CJK 統一漢字、全形標點、假名等視為雙寬
    width += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/.test(char)
      ? 2
      : 1;
  }
  return width;
}

function pad(text, width) {
  const value = String(text ?? '');
  return value + ' '.repeat(Math.max(0, width - displayWidth(value)));
}

/** columns: [{ key, label, align }] */
export function table(rows, columns) {
  if (rows.length === 0) return '（沒有資料）';

  const widths = columns.map((col) =>
    Math.max(displayWidth(col.label), ...rows.map((row) => displayWidth(row[col.key] ?? '')))
  );

  const header = columns.map((col, i) => pad(col.label, widths[i])).join('  ');
  const divider = widths.map((w) => '─'.repeat(w)).join('  ');
  const body = rows.map((row) =>
    columns
      .map((col, i) => {
        const value = String(row[col.key] ?? '');
        if (col.align !== 'right') return pad(value, widths[i]);
        return ' '.repeat(Math.max(0, widths[i] - displayWidth(value))) + value;
      })
      .join('  ')
  );

  return [header, divider, ...body].join('\n');
}

export function money(amount, currency = 'TWD') {
  const num = Number(amount ?? 0);
  const formatted = num.toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return currency === 'TWD' ? formatted : `${formatted} ${currency}`;
}

export function printError(error) {
  console.error(`✗ ${error.message}`);
  if (error.hint) console.error(`  ${error.hint}`);
}

/**
 * 給 agent 讀的輸出。
 * 表格是給人看的：中文對齊、千分位逗號、截短的 id，這些都會讓程式解析出錯。
 */
export function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}
