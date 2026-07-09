import { MONTH_ABBREVS, ZERO_DECIMAL_CURRENCIES } from './constants';

export function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

export function getTodayYmd() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// TWD is zero-decimal by this app's convention (see ZERO_DECIMAL_CURRENCIES) —
// storage keeps the raw computed value, only the display is rounded.
export function formatMoney(num) {
  return new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
}

/** 手機版用：四捨五入到整數，無小數 */
export function formatMoneyInteger(num) {
  const n = typeof num === 'number' ? num : parseFloat(num);
  return new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(isNaN(n) ? 0 : Math.round(n));
}

/**
 * Formats an amount for display in its own (non-TWD) transaction currency —
 * rounds to whole units for zero-decimal currencies (see ZERO_DECIMAL_CURRENCIES),
 * otherwise keeps 2 decimals. Display-only; never mutates the stored value.
 */
export function formatCurrencyAmount(amount, currencyCode) {
  const n = typeof amount === 'number' ? amount : parseFloat(amount);
  if (isNaN(n)) return '';
  const code = String(currencyCode || 'TWD').toUpperCase();
  const fractionDigits = ZERO_DECIMAL_CURRENCIES.has(code) ? 0 : 2;
  return new Intl.NumberFormat('zh-TW', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(n);
}

export function escapeHtml(s) {
  if (s == null) return '';
  const t = String(s);
  return t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatNumberWithCommas(value) {
  const cleaned = value.replace(/[^\d.]/g, '');
  const parts = cleaned.split('.');
  let integerPart = parts[0] || '';
  const decimalPart = parts.length > 1 ? '.' + parts[1].slice(0, 2) : '';
  if (integerPart) {
    integerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  return integerPart + decimalPart;
}

export function parseFormattedNumber(value) {
  return value.replace(/,/g, '');
}

export function formatMonthLabel(year, month) {
  return MONTH_ABBREVS[month - 1] + ' ' + year;
}

/** 年度回顧鎖定規則：當年度（含網址帶未來年份）在年底跨年前都不開放查看 */
export function isYearLocked(year) {
  return year >= new Date().getFullYear();
}

/** 年度回顧橫幅只在隔年 1~2 月出現，提示剛結束的上一年度回顧已出爐 */
export function isYearlyReviewAnnounceWindow(date = new Date()) {
  return date.getMonth() <= 1;
}

export function getDaysUntilDay(day) {
  if (!day || day < 1 || day > 31) return null;
  const today = new Date();
  const currentDay = today.getDate();
  const currentYear = today.getFullYear();
  let targetMonthIndex = today.getMonth();

  // 目標日已過就看下個月；日期夾在該月實際天數內（處理 29–31 遇小月的溢位）
  if (currentDay > day) targetMonthIndex += 1;
  const daysInTargetMonth = new Date(currentYear, targetMonthIndex + 1, 0).getDate();
  const nextDate = new Date(currentYear, targetMonthIndex, Math.min(day, daysInTargetMonth));

  const diffTime = nextDate - today;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

export function formatDateForDisplay(dateStr, isMobile) {
  if (!dateStr) return '';
  if (!isMobile) return dateStr;
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[1]}-${parts[2]}`;
  }
  return dateStr;
}

export function parseExpression(str) {
  if (!str) return NaN;
  const cleaned = String(str).replace(/\s/g, '');
  if (!/^[\d.+\-*/()]+$/.test(cleaned)) return NaN;
  try {
    const result = Function('"use strict"; return (' + cleaned + ')')();
    if (typeof result !== 'number' || !isFinite(result)) return NaN;
    return Math.round(result * 100) / 100;
  } catch {
    return NaN;
  }
}

export function parseChangelogMarkdown(text) {
  const entries = [];
  const sectionRegex = /^## \[([^\]]+)\]\s*-\s*([^\n]*)\s*$/gm;
  const sections = [];
  let m;
  while ((m = sectionRegex.exec(text)) !== null) {
    sections.push({
      version: m[1],
      date: m[2],
      headerEnd: m.index + m[0].length,
      nextHeaderStart: m.index,
    });
  }
  for (let i = 0; i < sections.length; i++) {
    const { version, date, headerEnd } = sections[i];
    const contentEnd = i + 1 < sections.length ? sections[i + 1].nextHeaderStart : text.length;
    const block = text.slice(headerEnd, contentEnd).trim();
    const changes = block
      .split('\n')
      .map((line) => line.replace(/^\s*[-*]\s+/, '').trim())
      .filter((line) => line.length > 0);
    entries.push({ version, date, changes });
  }
  return entries;
}
