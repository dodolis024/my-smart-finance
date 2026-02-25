/**
 * 單元測試 - utils 工具函數
 *
 * 注意：由於專案使用傳統 script 載入，utils.js 未使用 ES modules 匯出。
 * 此測試檔使用與 src/utils.js 相同的純函數實作（需保持同步）。
 * 未來可考慮將 utils 重構為可匯出模組以消除重複。
 */
import { describe, it, expect } from 'vitest';

// 從 src/utils.js 複製的純函數實作（用於測試）
// 必須與 src/utils.js 保持同步
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function formatMoney(num) {
  return new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    minimumFractionDigits: 0,
  }).format(num);
}

function getTodayYmd() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function escapeHtml(s) {
  if (s == null) return '';
  const t = String(s);
  return t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatNumberWithCommas(value) {
  const cleaned = value.replace(/[^\d.]/g, '');
  const parts = cleaned.split('.');
  let integerPart = parts[0] || '';
  const decimalPart = parts.length > 1 ? '.' + parts[1].slice(0, 2) : '';
  if (integerPart) {
    integerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  return integerPart + decimalPart;
}

function parseFormattedNumber(value) {
  return value.replace(/,/g, '');
}

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
