/**
 * 旅程（消費分析第二階段）的計算，純函式。
 *
 * 一趟旅程 = 起訖日期內的支出，扣掉排除的交易，再加上手動加入的範圍外交易（例如出發前訂的機票）。
 * 排除分兩種：使用者手動排除（excludedIds），以及建立或改日期時自動排除的固定支出（fixedIds，
 * 例如旅途中剛好扣的房租）。固定支出在建立當下就算好存起來，之後換哪個月份看，旅程的內容都一樣；
 * 代價是建立之後才記進來的房租不會自動排除，要使用者自己排除。
 * 使用者把自動排除的固定支出加回來時記在 keptIds，之後改日期重新判斷也不會再排除它。
 *
 * 設定存在 settings（key: spending_analysis_trips）：
 *   { trips: [{ id, name, start, end, excludedIds, fixedIds, keptIds, includedIds }], dismissed: ['EUR:2026-09-24:2026-09-26'] }
 */
import { detectFixedItems } from '@/lib/spendingAnalysis';

// 系統提示：連續 2 天以上出現平常不用的幣別、總共至少 3 筆，就問要不要建成旅程。
// 「平常用的幣別」：用得最多的那個，加上有記帳的日子裡至少 homeDayShare 的天數都有用到的（搬家換了幣別時兩個都算）
export const TRIP_SUGGEST_RULE = { minDays: 2, minCount: 3, homeDayShare: 0.2 };

const ids = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []);
const isDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** settings 讀回來的值整理成固定形狀；壞掉的旅程直接略過，不讓整頁壞掉 */
export function normalizeTripsSetting(value) {
  const trips = (Array.isArray(value?.trips) ? value.trips : [])
    .filter((trip) => trip && typeof trip.id === 'string' && isDate(trip.start) && isDate(trip.end))
    .map((trip) => ({
      id: trip.id,
      name: String(trip.name ?? '').trim(),
      start: trip.start,
      end: trip.end,
      excludedIds: ids(trip.excludedIds),
      fixedIds: ids(trip.fixedIds),
      keptIds: ids(trip.keptIds),
      includedIds: ids(trip.includedIds),
    }));
  return { trips, dismissed: ids(value?.dismissed) };
}

/** 開始日早的排前面；同一天開始的照 id，結果才固定 */
function byStart(a, b) {
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

/**
 * 交易 id → 所屬旅程。手動加入的優先；日期範圍重疊的兩趟旅程，歸開始日較早的那趟。
 * 收入不算進旅程。
 */
export function buildTripIndex(trips, rows) {
  const sorted = [...(trips || [])].sort(byStart);
  const prepared = sorted.map((trip) => ({ trip, out: new Set([...trip.excludedIds, ...trip.fixedIds]) }));
  const expenses = (rows || []).filter((tx) => tx.type !== 'income');
  const index = new Map();
  const rowIds = new Set(expenses.map((tx) => tx.id));
  for (const trip of sorted) {
    for (const id of trip.includedIds) if (rowIds.has(id) && !index.has(id)) index.set(id, trip);
  }
  for (const tx of expenses) {
    if (index.has(tx.id)) continue;
    const hit = prepared.find(({ trip, out }) => tx.date >= trip.start && tx.date <= trip.end && !out.has(tx.id));
    if (hit) index.set(tx.id, hit.trip);
  }
  return index;
}

/**
 * 旅程明細要列的每一筆：日期範圍內的支出（含被排除的）＋手動加入的。
 * status：in 算進這趟、added 範圍外手動加入、excluded 手動排除、fixed 自動排除的固定支出、other 歸另一趟重疊的旅程。
 * 在這趟排除的，即使因此落到另一趟重疊的旅程，這裡仍顯示「已排除」，才找得到「加回」。
 */
export function tripEntries(trip, rows, index) {
  const excluded = new Set(trip.excludedIds);
  const fixed = new Set(trip.fixedIds);
  const included = new Set(trip.includedIds);
  return (rows || [])
    .filter((tx) => tx.type !== 'income' && (included.has(tx.id) || (tx.date >= trip.start && tx.date <= trip.end)))
    .map((tx) => {
      const owner = index.get(tx.id);
      const ownedElsewhere = !!owner && owner.id !== trip.id;
      let status;
      if (included.has(tx.id)) status = ownedElsewhere ? 'other' : 'added';
      else if (fixed.has(tx.id)) status = 'fixed';
      else if (excluded.has(tx.id)) status = 'excluded';
      else status = ownedElsewhere ? 'other' : 'in';
      return { tx, status, otherTrip: status === 'other' ? owner : null };
    })
    .sort((a, b) => `${a.tx.date} ${a.tx.time || ''}`.localeCompare(`${b.tx.date} ${b.tx.time || ''}`));
}

/** 每趟旅程的總額、筆數、排除筆數與前幾大分類；新 → 舊 */
export function summarizeTrips(trips, rows, index, { toValue, uncategorizedLabel = '' }) {
  const catOf = (tx) => (tx.category && String(tx.category).trim()) || uncategorizedLabel;
  return [...(trips || [])]
    .sort((a, b) => byStart(b, a))
    .map((trip) => {
      const entries = tripEntries(trip, rows, index);
      const members = entries.filter((e) => e.status === 'in' || e.status === 'added').map((e) => e.tx);
      const byCategory = new Map();
      for (const tx of members) byCategory.set(catOf(tx), (byCategory.get(catOf(tx)) || 0) + toValue(tx));
      return {
        trip,
        entries,
        members,
        total: members.reduce((sum, tx) => sum + toValue(tx), 0),
        count: members.length,
        excludedCount: entries.filter((e) => e.status === 'excluded' || e.status === 'fixed').length,
        categories: [...byCategory].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
      };
    });
}

/**
 * 範圍內哪些是固定支出（房租、訂閱）：rows 要涵蓋前後幾個月，才比得出「每個月都有」。
 * keptIds 是使用者加回來的，不再排除。
 */
export function fixedIdsInRange(rows, start, end, keptIds = []) {
  const expenses = (rows || []).filter((tx) => tx.type !== 'income');
  const fixed = detectFixedItems(expenses);
  const kept = new Set(keptIds);
  return expenses.filter((tx) => fixed.has(tx.id) && !kept.has(tx.id) && tx.date >= start && tx.date <= end).map((tx) => tx.id);
}

const dayIndex = (ymd) => Math.round(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))) / 86400000);

export const suggestionKey = (s) => `${s.currency}:${s.start}:${s.end}`;

/** 'EUR:2026-09-24:2026-09-26' → { currency, start, end }；格式不對回傳 null */
function parseSuggestionKey(key) {
  const m = /^([^:]+):(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(key);
  return m ? { currency: m[1], start: m[2], end: m[3] } : null;
}

/**
 * 系統提示的旅程：平常用的幣別以外，其他幣別連續出現 minDays 天以上、總共至少 minCount 筆就提示。
 * 固定支出（例如外幣訂閱剛好連續幾天扣款）不算。跟現有旅程日期重疊的不提示；
 * 使用者按過「不是旅程」的，同一幣別、日期有重疊就不再提示（之後多記一天、或換個月份看邊界被截在別處，都不會又跳出來）。
 * 國內旅行（幣別跟平常一樣）偵測不到，只能手動建立。新 → 舊。
 */
export function suggestTrips(expenses, trips, dismissed, rule = TRIP_SUGGEST_RULE) {
  const all = (expenses || []).filter((tx) => tx.type !== 'income' && tx.currency);
  if (!all.length) return [];
  const fixed = detectFixedItems(all);
  const list = all.filter((tx) => !fixed.has(tx.id));
  if (!list.length) return [];
  const usage = new Map();
  const daysByCurrency = new Map();
  for (const tx of list) {
    usage.set(tx.currency, (usage.get(tx.currency) || 0) + 1);
    if (!daysByCurrency.has(tx.currency)) daysByCurrency.set(tx.currency, new Set());
    daysByCurrency.get(tx.currency).add(tx.date);
  }
  const recordDays = new Set(list.map((tx) => tx.date)).size;
  const home = new Set([[...usage].sort((a, b) => b[1] - a[1])[0][0]]);
  for (const [currency, days] of daysByCurrency) {
    if (days.size >= recordDays * rule.homeDayShare) home.add(currency);
  }

  const byCurrency = new Map();
  for (const tx of list) {
    if (home.has(tx.currency)) continue;
    if (!byCurrency.has(tx.currency)) byCurrency.set(tx.currency, new Map());
    const days = byCurrency.get(tx.currency);
    days.set(tx.date, (days.get(tx.date) || 0) + 1);
  }

  const dismissedRanges = (dismissed || []).map(parseSuggestionKey).filter(Boolean);
  const overlapsTrip = (start, end) => (trips || []).some((trip) => start <= trip.end && end >= trip.start);
  const wasDismissed = (s) => dismissedRanges.some((d) => d.currency === s.currency && s.start <= d.end && s.end >= d.start);
  const result = [];
  for (const [currency, days] of byCurrency) {
    const dates = [...days.keys()].sort();
    let run = [dates[0]];
    const flush = () => {
      const count = run.reduce((sum, d) => sum + days.get(d), 0);
      const s = { currency, start: run[0], end: run[run.length - 1], count };
      if (run.length >= rule.minDays && count >= rule.minCount
        && !overlapsTrip(s.start, s.end) && !wasDismissed(s)) {
        result.push({ ...s, key: suggestionKey(s) });
      }
    };
    for (const date of dates.slice(1)) {
      if (dayIndex(date) - dayIndex(run[run.length - 1]) === 1) run.push(date);
      else { flush(); run = [date]; }
    }
    flush();
  }
  return result.sort((a, b) => (a.start < b.start ? 1 : -1));
}

/** 'YYYY-MM-DD' 兩端 → '9/20 – 9/26'；不是今年或跨年才帶年份 */
export function formatTripRange(start, end, currentYear) {
  const part = (ymd, withYear) => {
    const [y, m, d] = ymd.split('-').map(Number);
    return withYear ? `${y}/${m}/${d}` : `${m}/${d}`;
  };
  const withYear = start.slice(0, 4) !== end.slice(0, 4) || Number(start.slice(0, 4)) !== currentYear;
  return start === end ? part(start, withYear) : `${part(start, withYear)} – ${part(end, withYear)}`;
}
