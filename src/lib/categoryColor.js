import {
  CHART_COLORS, CHART_COLORS_ROSE, CHART_COLORS_GRAY, CHART_COLORS_DAWN, CHART_COLORS_SODA,
  CHART_COLORS_LAVENDER, CHART_COLORS_SORBET, CHART_COLORS_PEACH, CHART_COLORS_LIME,
  CHART_COLORS_MAPLE,
} from './constants';

const THEME_PALETTES = {
  rose: CHART_COLORS_ROSE,
  graphite: CHART_COLORS_GRAY,
  dawn: CHART_COLORS_DAWN,
  soda: CHART_COLORS_SODA,
  lavender: CHART_COLORS_LAVENDER,
  sorbet: CHART_COLORS_SORBET,
  peach: CHART_COLORS_PEACH,
  lime: CHART_COLORS_LIME,
  maple: CHART_COLORS_MAPLE,
};

/** 目前主題的圖表色盤（圓餅圖、年度回顧、交易列表共用同一組） */
export function getChartPalette(theme) {
  return THEME_PALETTES[theme] || CHART_COLORS;
}

/**
 * 期間內「各支出分類 → 顏色」的對應。
 *
 * 顏色是按分類的支出金額由大到小排名分配（palette[名次]），這是圓餅圖既有的規則；
 * 交易列表共用同一份 map，同一個分類在圓餅圖與列表上才會是同一個顏色。
 * 因此這份 map 一定要用「未篩選的期間資料」算——拿篩選後的資料算會改變排名，
 * 列表的顏色就會跟旁邊的圓餅圖對不起來。
 *
 * @param {Array} history 期間內的完整交易
 * @param {string[]} incomeCategories 收入分類（不進圓餅圖，也就沒有顏色）
 * @param {string[]} palette 見 getChartPalette
 * @param {string} uncategorizedLabel 未分類的顯示名稱
 * @returns {Map<string, string>}
 */
export function buildCategoryColorMap(history, incomeCategories, palette, uncategorizedLabel) {
  const incomeSet = new Set(incomeCategories || []);
  const byCategory = new Map();

  for (const tx of history || []) {
    const cat = (tx.category && String(tx.category).trim()) ? tx.category : uncategorizedLabel;
    if (incomeSet.has(cat)) continue;
    const amount = typeof tx.twdAmount === 'number' ? tx.twdAmount : 0;
    byCategory.set(cat, (byCategory.get(cat) || 0) + amount);
  }

  const map = new Map();
  [...byCategory.entries()]
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .forEach(([cat], i) => map.set(cat, palette[i % palette.length]));
  return map;
}
