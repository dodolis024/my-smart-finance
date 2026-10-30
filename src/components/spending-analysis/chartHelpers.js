// 消費分析頁兩張 Chart.js 圖（每月長條圖、分類折線圖）共用的小工具

/** 讀主題的 CSS 變數；讀不到（例如還沒套上主題）用 fallback */
export function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** 刻度只要看得出量級：1,234 → 1.2k */
export function compact(value) {
  if (Math.abs(value) < 1000) return String(Math.round(value));
  const k = value / 1000;
  return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
}
