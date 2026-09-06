/**
 * 期間（粒度＋錨點）計算的集中處。
 *
 * 其餘程式只吃 { startDate, endDate } 與現成的標籤字串，不需要知道「粒度」這個概念。
 * 之後要加 'week' / 'day' 時，只需在本檔各函式補一個分支，查詢／加總／圖表／分頁／匯出都不用動。
 */
import { getTodayYmd } from '@/lib/utils';
import { MONTH_ABBREVS } from '@/lib/constants';

/** 支援的粒度。UI 目前只提供月／年兩個頁籤 */
export const GRANULARITIES = ['month', 'year'];

const pad = (n) => String(n).padStart(2, '0');

/**
 * 期間 → 查詢用的日期區間（含端點，'YYYY-MM-DD'）。
 * 年模式的結束日以「今天」為上限：檢視當年度時只看已經發生的消費
 * （使用者可手動記未來日期的交易，那些刻意不計入）。過去年份則自然是整年。
 * @param {{granularity: 'month'|'year', year: number, month?: number}} period
 */
export function getPeriodRange(period) {
  const today = getTodayYmd(); // 'YYYY-MM-DD'，客戶端日期
  if (period.granularity === 'year') {
    const start = `${period.year}-01-01`;
    const end = `${period.year}-12-31`;
    return { startDate: start, endDate: end < today ? end : today };
  }
  const lastDay = new Date(period.year, period.month, 0).getDate();
  return {
    startDate: `${period.year}-${pad(period.month)}-01`,
    endDate: `${period.year}-${pad(period.month)}-${pad(lastDay)}`,
  };
}

/**
 * 觸發鈕用的標籤。年就是年份；月預設是 Sep 2026，
 * 呼叫端可傳入 formatMonth(year, month) 改用語系化格式（中文：2026年9月）。
 */
export function getPeriodLabel(period, formatMonth) {
  if (period.granularity === 'year') return String(period.year);
  return formatMonth
    ? formatMonth(period.year, period.month)
    : `${MONTH_ABBREVS[period.month - 1]} ${period.year}`;
}

/** 匯出檔名與確認訊息用（不含副檔名） */
export function getPeriodFileLabel(period) {
  return period.granularity === 'year'
    ? String(period.year)
    : `${period.year}-${pad(period.month)}`;
}

/** 該期間是否包含今天（決定要不要顯示「回這個月／回這一年」鈕） */
export function isCurrentPeriod(period) {
  const now = new Date();
  if (period.granularity === 'year') return period.year === now.getFullYear();
  return period.year === now.getFullYear() && period.month === now.getMonth() + 1;
}

/** 今天所在的期間（「回這個月／回這一年」用） */
export function getCurrentPeriod(granularity) {
  const now = new Date();
  return granularity === 'year'
    ? { granularity: 'year', year: now.getFullYear() }
    : { granularity: 'month', year: now.getFullYear(), month: now.getMonth() + 1 };
}

/** i18n 的期間名稱 key（'這個月' / '這一年'） */
export function getPeriodNameKey(granularity) {
  return `dashboard.period.${granularity}`;
}
