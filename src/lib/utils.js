import { MONTH_ABBREVS } from './constants';

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

export function formatMoney(num) {
  return new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    minimumFractionDigits: 0,
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

export function getDaysUntilDay(day) {
  if (!day || day < 1 || day > 31) return null;
  const today = new Date();
  const currentDay = today.getDate();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();

  let nextDate = new Date(currentYear, currentMonth, day);
  if (currentDay > day) {
    nextDate.setMonth(currentMonth + 1);
  }
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
