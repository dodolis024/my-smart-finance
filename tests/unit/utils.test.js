/**
 * 單元測試 - utils 工具函數
 */
import { describe, it, expect } from 'vitest';
import {
  debounce,
  formatMoney,
  getTodayYmd,
  escapeHtml,
  formatNumberWithCommas,
  parseFormattedNumber,
  parseChangelogMarkdown,
} from '@/lib/utils';

describe('utils - formatMoney', () => {
  it('應正確格式化台幣金額（含千分位）', () => {
    // Node.js 與瀏覽器的 Intl 可能輸出不同貨幣符號，驗證千分位與數字正確即可
    expect(formatMoney(1234)).toContain('1,234');
    expect(formatMoney(0)).toContain('0');
    expect(formatMoney(1000000)).toContain('1,000,000');
  });

  it('應處理負數', () => {
    expect(formatMoney(-500)).toContain('-');
  });
});

describe('utils - getTodayYmd', () => {
  it('應回傳 YYYY-MM-DD 格式', () => {
    const result = getTodayYmd();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('月份與日期應補零', () => {
    const result = getTodayYmd();
    const [, month, day] = result.split('-');
    expect(month).toHaveLength(2);
    expect(day).toHaveLength(2);
  });
});

describe('utils - escapeHtml', () => {
  it('應轉義 HTML 特殊字元', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
    expect(escapeHtml('a&b')).toBe('a&amp;b');
  });

  it('應處理 null 和 undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('應將非字串轉為字串', () => {
    expect(escapeHtml(123)).toBe('123');
  });
});

describe('utils - formatNumberWithCommas', () => {
  it('應加上千分位', () => {
    expect(formatNumberWithCommas('1234')).toBe('1,234');
    expect(formatNumberWithCommas('1234567')).toBe('1,234,567');
  });

  it('應處理小數點後兩位', () => {
    expect(formatNumberWithCommas('1234.5')).toBe('1,234.5');
    expect(formatNumberWithCommas('1234.567')).toBe('1,234.56');
  });

  it('應移除非數字字元', () => {
    expect(formatNumberWithCommas('1,234abc')).toBe('1,234');
  });
});

describe('utils - parseFormattedNumber', () => {
  it('應移除千分位逗點', () => {
    expect(parseFormattedNumber('1,234')).toBe('1234');
    expect(parseFormattedNumber('1,234,567.89')).toBe('1234567.89');
  });
});

describe('utils - debounce', () => {
  it('應延遲執行函數', async () => {
    let called = 0;
    const fn = () => {
      called++;
    };
    const debounced = debounce(fn, 50);

    debounced();
    debounced();
    expect(called).toBe(0);

    await new Promise((r) => setTimeout(r, 60));
    expect(called).toBe(1);
  });

  it('應在延遲期內只執行最後一次', async () => {
    let lastArg = null;
    const fn = (x) => {
      lastArg = x;
    };
    const debounced = debounce(fn, 30);

    debounced(1);
    debounced(2);
    debounced(3);

    await new Promise((r) => setTimeout(r, 50));
    expect(lastArg).toBe(3);
  });
});

describe('utils - parseChangelogMarkdown', () => {
  it('應解析版本標頭與日期', () => {
    const text = `## [1.0.0] - 2026-01-15

- 初版上線
- 交易記帳`;
    const result = parseChangelogMarkdown(text);
    expect(result).toHaveLength(1);
    expect(result[0].version).toBe('1.0.0');
    expect(result[0].date).toBe('2026-01-15');
    expect(result[0].changes).toEqual(['初版上線', '交易記帳']);
  });

  it('應解析多個版本區塊', () => {
    const text = `## [1.0.0] - 2026-01-15

- 初版

## [1.1.0] - 2026-02-20

- 新功能`;
    const result = parseChangelogMarkdown(text);
    expect(result).toHaveLength(2);
    expect(result[0].version).toBe('1.0.0');
    expect(result[0].changes).toEqual(['初版']);
    expect(result[1].version).toBe('1.1.0');
    expect(result[1].changes).toEqual(['新功能']);
  });

  it('應去除變化項目前的 - 或 * 前綴', () => {
    const text = `## [1.0.0] - 2026-01-15

* 星號項目
-  dash項目`;
    const result = parseChangelogMarkdown(text);
    expect(result[0].changes).toEqual(['星號項目', 'dash項目']);
  });

  it('空字串應回傳空陣列', () => {
    expect(parseChangelogMarkdown('')).toEqual([]);
  });
});
