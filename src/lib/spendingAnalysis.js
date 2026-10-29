import { ZERO_DECIMAL_CURRENCIES } from '@/lib/constants';
import { convertTx, isRateTableUsable } from '@/lib/displayCurrency';

/**
 * 消費分析頁的計算（純函式，不碰畫面與資料庫）。
 *
 * 核心規則：
 * 1. 每一筆都照實際金額算：大額單筆、旅程都算進「平常」、本月與長條圖，數字就是實際花的錢。
 * 2. 大額單筆只標示：單筆金額達到使用者設的門檻（預設 NT$10,000）就列出來、在卡片上提一句。
 *    固定支出（房租、訂閱、保險這種每個月都付一次的）再大也不標；旅程裡的交易歸旅程，也不標。
 * 3. 平常 = 目標月份前 N 個月（使用者選一季／半年／一年，N = 3／6／12）每個月支出的平均。
 *    卡片、長條圖的虛線、各分類的平常都是這一個數字；長條圖畫的就是這 N 個月加上目標月份。
 *    分析起點是下限：比它早的月份不算、也不畫（月份，從 1 號算起）；沒設定就從帳本第二個月起算：
 *    第一個月多半是月中才開始記，金額偏低。一筆支出都沒有的月份多半是沒記帳，不算；一個月都沒有就不比較。
 *    「連續上升」從這個月往回數到分析起點，跟選幾個月無關。
 * 4. 這個月還沒過完時，跟「平常同期」比：平常那幾個月各自 1 號到今天這一天花了多少的平均，不把已經花的放大成整個月
 *    （一次買一雙鞋的分類照天數放大，會變成「月底前還會再買」）。月底預估 = 已經花的 + 平常在今天之後會花的。
 *    月初前幾天資料太少，不跟平常比。
 * 5. 旅程（見 lib/trips.js）不拆進各分類，分類清單也不列；長條圖另畫一段斜線，各分類的平常不含旅程。
 */

// 大額單筆門檻的預設值；twd 是存設定當下換成台幣的金額，門檻幣別的匯率讀不到時拿來比
export const DEFAULT_LARGE_THRESHOLD = { amount: 10000, currency: 'TWD', twd: 10000 };
// 固定支出：前後 3 個月內至少另有 2 個月「剛好出現一次」而且金額跟這筆差不到 30%
export const FIXED_ITEM_RULE = { withinMonths: 3, minOtherMonths: 2, amountTolerance: 0.3 };
// 平常拿幾個月來平均（一季／半年／一年），長條圖跟著畫這幾個月；預設半年
export const CHART_SPANS = [3, 6, 12];
export const DEFAULT_CHART_SPAN = 6;
// 這個月過了幾天以上才推估月底、跟平常比（第 7 天起）
export const EARLY_MONTH_DAYS = 7;

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' → 'YYYY-MM' */
export function ymOf(date) {
  return String(date).slice(0, 7);
}

/** 'YYYY-MM' 往前（負數）或往後推 n 個月 */
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const index = y * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/** 兩個 'YYYY-MM' 差幾個月（a − b） */
export function monthGap(a, b) {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (ay * 12 + am) - (by * 12 + bm);
}

export function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** 目標月份前面 span 個月加上目標月份本身（舊 → 新，共 span + 1 個）：平常用前面那幾個，長條圖全部畫 */
export function chartMonths(targetYm, span = DEFAULT_CHART_SPAN) {
  return Array.from({ length: span + 1 }, (_, i) => addMonths(targetYm, i - span));
}

/**
 * 橫軸的月份：範圍跨年時，第一個月和每年 1 月下面多一行年份（陣列標籤 Chart.js 會分兩行畫），
 * 都在同一年就只寫月份
 */
export function monthAxisLabels(yms, labelOf) {
  const crossesYear = yms.length > 0 && yms[0].slice(0, 4) !== yms[yms.length - 1].slice(0, 4);
  return yms.map((ym, i) => (crossesYear && (i === 0 || ym.endsWith('-01')) ? [labelOf(ym), ym.slice(0, 4)] : labelOf(ym)));
}

/** from 到 to 的每個月（含頭尾，舊 → 新）；from 比 to 晚就是空的 */
export function monthsBetween(fromYm, toYm) {
  const count = monthGap(toYm, fromYm) + 1;
  return Array.from({ length: Math.max(count, 0) }, (_, i) => addMonths(fromYm, i));
}

/** 存在設定裡的分析起點：{ month: 'YYYY-MM' }；沒設定（自動）是 null */
export function normalizeStartYm(value) {
  const month = value?.month;
  return typeof month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null;
}

/** 存在設定裡的長條圖月數：{ months: 6 }；不是可選的值就用預設 */
export function normalizeChartSpan(value) {
  const months = Number(value?.months);
  return CHART_SPANS.includes(months) ? months : DEFAULT_CHART_SPAN;
}

/**
 * 分析從哪個月開始：使用者設的起點，沒設定就是帳本第一個月。起點設得比開始記帳還早，從開始記帳那個月算。
 * 這個月以前的月份不分析（月份箭頭也停在這裡），長條圖上淡淡顯示。
 */
export function analysisStartOf(firstYm, startYm) {
  if (!firstYm) return null;
  return startYm && startYm > firstYm ? startYm : firstYm;
}

/** 「平常」從哪個月開始算：使用者設的起點照算；自動的話跳過帳本第一個月 */
export function baselineStartOf(firstYm, startYm) {
  if (!firstYm) return null;
  return startYm ? analysisStartOf(firstYm, startYm) : addMonths(firstYm, 1);
}

const twdOf = (tx) => (typeof tx.twdAmount === 'number' ? tx.twdAmount : 0);

/** 同一項固定支出的辨識鍵：分類＋項目名稱（忽略大小寫與多餘空白）；沒有名稱就無從比對 */
function fixedKeyOf(tx) {
  const name = String(tx.itemName ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!name) return null;
  return `${String(tx.category ?? '').trim()}\u0000${name}`;
}

/**
 * 找出固定支出（房租、訂閱、保險），回傳交易 id 的 Set。
 *
 * 條件三個都要成立：
 * - 這一筆所在的月份，同名項目只出現這一次（每天都買的便當、捷運一個月很多筆，是日常消費，不算）
 * - 前後 withinMonths 個月內，至少另有 minOtherMonths 個月也「剛好出現一次」，而且金額跟這筆差不到 amountTolerance
 *   （平常 2 千的 Uniqlo 某月買了 1.5 萬：那一筆找不到金額相近的月份，不算固定；
 *   逐月各自比對而不是跟平均比，那一個暴增的月份才不會把其他正常月份也拉出固定支出）
 * 前後都看：長條圖最早的月份往前沒有資料，靠之後的月份也認得出來；正在看的這個月只有之前的月份可比。
 */
export function detectFixedItems(expenses, rule = FIXED_ITEM_RULE) {
  const byKey = new Map();
  for (const tx of expenses || []) {
    const key = fixedKeyOf(tx);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, new Map());
    const months = byKey.get(key);
    const ym = ymOf(tx.date);
    if (!months.has(ym)) months.set(ym, []);
    months.get(ym).push(tx);
  }

  const ids = new Set();
  for (const months of byKey.values()) {
    for (const [ym, txs] of months) {
      if (txs.length !== 1) continue;
      const amount = twdOf(txs[0]);
      let similarMonths = 0;
      for (const [otherYm, otherTxs] of months) {
        if (otherYm === ym || otherTxs.length !== 1) continue;
        if (Math.abs(monthGap(otherYm, ym)) > rule.withinMonths) continue;
        if (Math.abs(twdOf(otherTxs[0]) - amount) <= Math.abs(amount) * rule.amountTolerance) similarMonths++;
      }
      if (similarMonths >= rule.minOtherMonths) ids.add(txs[0].id);
    }
  }
  return ids;
}

/** 設定裡存的門檻 → { amount, currency, twd }；格式不對就用預設值 */
export function normalizeLargeThreshold(value) {
  const amount = Number(value?.amount);
  const twd = Number(value?.twd);
  const currency = typeof value?.currency === 'string' ? value.currency.toUpperCase() : '';
  if (!(amount > 0) || !currency || !(twd > 0)) return DEFAULT_LARGE_THRESHOLD;
  return { amount, currency, twd };
}

/** 四捨五入到該幣別畫面上顯示的位數（台幣、日圓到個位，其他到分） */
export function roundForCurrency(value, currency) {
  const digits = ZERO_DECIMAL_CURRENCIES.has(String(currency || 'TWD').toUpperCase()) ? 0 : 2;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * 大額門檻的比法：每一筆換成「門檻的幣別」、四捨五入到畫面上顯示的位數，再跟門檻比。
 * - 換算跟顯示幣別同一套（lib/displayCurrency.js 的 convertTx）：門檻 £250 時，畫面上顯示 £250.00 的那筆一定會被標，
 *   不會因為匯率換算多出 £249.997 這種尾數而漏掉；換顯示幣別也不會改變哪幾筆被標。
 * - 門檻幣別的匯率表讀不到（離線又沒有快取）時，退回用台幣比存設定當下換好的 twd，至少不會整批標錯。
 * @param {{ amount: number, currency: string, twd: number }} threshold
 * @param {object|null} table 門檻幣別的匯率表（useRateTables）；台幣門檻不需要
 * @returns {{ valueOf: (tx: object) => number, min: number }}
 */
export function largeMeasure(threshold, table) {
  const { amount, currency, twd } = threshold;
  if (currency === 'TWD') return { valueOf: (tx) => roundForCurrency(twdOf(tx), 'TWD'), min: amount };
  if (isRateTableUsable(table)) {
    return { valueOf: (tx) => roundForCurrency(convertTx(tx, currency, table).value, currency), min: amount };
  }
  return { valueOf: (tx) => roundForCurrency(twdOf(tx), 'TWD'), min: Math.round(twd) };
}

/** 匯率表裡最新的匯率（1 單位 = 多少台幣）：今日匯率優先，沒有就用歷史最後一筆；都沒有回 null */
function latestRate(table) {
  const live = Number(table?.live);
  if (live > 0) return live;
  const last = table?.history?.[table.history.length - 1]?.[1];
  return Number(last) > 0 ? Number(last) : null;
}

/**
 * 使用者輸入的門檻 → 要存的設定。輸入的幣別就是畫面正在顯示的幣別；同時用今天的匯率換成台幣存一份備用。
 * 金額要先檢查 > 0；外幣的匯率讀不到回 null。
 */
export function thresholdFromInput(amount, currency, table) {
  const rounded = roundForCurrency(amount, currency);
  if (currency === 'TWD') return { amount: rounded, currency, twd: rounded };
  const rate = latestRate(table);
  return rate ? { amount: rounded, currency, twd: rounded * rate } : null;
}

/** 只留兩位有效數字：235.8 → 240、48,316 → 48,000、10,592 → 11,000 */
export function roundSignificant(value, digits = 2) {
  return value > 0 ? Number(value.toPrecision(digits)) : value;
}

/**
 * 門檻在正在顯示的幣別下怎麼寫。
 * - 幣別跟門檻一樣：就是當初輸入的金額，approx = false
 * - 不一樣：用今天的匯率換算、只留兩位有效數字，approx = true（畫面加「約」）。
 *   只是給人看的參考，判斷哪幾筆是大額一律照門檻本身的幣別（largeMeasure），換顯示幣別不會改變結果。
 * 門檻幣別的匯率讀不到就用存設定當下的台幣備用值；顯示幣別的匯率讀不到回 null（照門檻本身的幣別寫）。
 * @returns {{ amount: number, currency: string, approx: boolean } | null}
 */
export function thresholdForDisplay(threshold, currency, thresholdTable, displayTable) {
  if (threshold.currency === currency) return { amount: threshold.amount, currency, approx: false };
  const thresholdRate = threshold.currency === 'TWD' ? 1 : latestRate(thresholdTable);
  const twd = thresholdRate ? threshold.amount * thresholdRate : threshold.twd;
  const displayRate = currency === 'TWD' ? 1 : latestRate(displayTable);
  if (!displayRate) return null;
  return { amount: roundSignificant(twd / displayRate), currency, approx: true };
}

/**
 * 找出大額單筆，回傳交易 id 的 Set：金額達到門檻就算，跟當月總共花多少無關
 * （用比例的話，同一筆會隨著月中累積越來越多，一下是大額、一下又不是）。
 * exemptIds（固定支出）不算。
 */
export function detectLargeItems(expenses, measure = largeMeasure(DEFAULT_LARGE_THRESHOLD), exemptIds = new Set()) {
  const ids = new Set();
  for (const tx of expenses || []) {
    if (!exemptIds.has(tx.id) && measure.valueOf(tx) >= measure.min) ids.add(tx.id);
  }
  return ids;
}

/** 平常從哪個月算起：目標月份往前 span 個月，但不早於平常的下限（baselineStartOf）；沒有任何交易時是 null */
export function baselineFromOf(targetYm, firstYm, startYm = null, span = DEFAULT_CHART_SPAN) {
  const floor = baselineStartOf(firstYm, startYm);
  if (!floor) return null;
  const windowStart = addMonths(targetYm, -span);
  return floor > windowStart ? floor : windowStart;
}

/**
 * 「平常」用哪幾個月：baselineFromOf 到目標月份的前一個月。
 * 回傳新 → 舊；沒有記帳的月份由 buildSpendingAnalysis 再扣掉。
 */
export function baselineMonths(targetYm, firstYm, startYm = null, span = DEFAULT_CHART_SPAN) {
  const from = baselineFromOf(targetYm, firstYm, startYm, span);
  return from ? monthsBetween(from, addMonths(targetYm, -1)).reverse() : [];
}

/** 數列尾端連續上升了幾個月（最後一個值比前一個大，再往前比，直到不再上升） */
export function risingStreak(values) {
  let n = 0;
  for (let i = values.length - 1; i > 0 && values[i] > values[i - 1]; i--) n++;
  return n;
}

/**
 * 組出整頁要的數字。
 *
 * @param {object} params
 * @param {object[]} params.expenses     支出交易（駝峰形狀，含 id/date/category/itemName/twdAmount）：分析起點到目標月份，
 *                                       最好再多前後 3 個月，固定支出才認得出來；範圍外的只用來辨認固定支出
 * @param {string}   params.targetYm     正在看的月份 'YYYY-MM'
 * @param {string}   params.todayYmd     今天 'YYYY-MM-DD'（客戶端日期）
 * @param {string|null} params.firstYm   帳本第一筆交易所在月份；沒有任何交易時為 null
 * @param {string|null} [params.startYm] 使用者設的分析起點 'YYYY-MM'；null 是自動（帳本第二個月起）
 * @param {number}   [params.chartSpan]  平常拿前幾個月平均（3／6／12），長條圖也畫這幾個月
 * @param {{ valueOf: Function, min: number }} [params.measure] 大額門檻的比法（largeMeasure），預設 NT$10,000
 * @param {(tx: object) => number} [params.toValue] 單筆換算成顯示幣別的金額，預設用台幣
 * @param {string} [params.uncategorizedLabel]
 * @param {Map<string, {id: string, name: string}>} [params.tripOf] 交易 id → 所屬旅程
 */
export function buildSpendingAnalysis({
  expenses,
  targetYm,
  todayYmd,
  firstYm,
  startYm = null,
  chartSpan = DEFAULT_CHART_SPAN,
  measure = largeMeasure(DEFAULT_LARGE_THRESHOLD),
  toValue = twdOf,
  uncategorizedLabel = '',
  tripOf = new Map(),
}) {
  const viewStart = analysisStartOf(firstYm, startYm);
  // 平常的下限（連續上升往回數到這裡）與這次選的月數實際從哪個月算
  const floor = baselineStartOf(firstYm, startYm);
  const baseFrom = baselineFromOf(targetYm, firstYm, startYm, chartSpan);
  // 連續上升要從分析起點一路看到這個月；平常與圖表只看前 chartSpan 個月
  const windowStart = chartMonths(targetYm, chartSpan)[0];
  const allYms = monthsBetween(viewStart && viewStart < windowStart ? viewStart : windowStart, targetYm);
  const byMonth = new Map(allYms.map((ym) => [ym, []]));
  for (const tx of expenses || []) byMonth.get(ymOf(tx.date))?.push(tx);
  const isTrip = (tx) => tripOf.has(tx.id);
  // 固定支出用全部傳進來的交易判斷：只看分析範圍的話，最早幾個月往前比不到，換個月份看結果就會不同
  const fixed = detectFixedItems(expenses);

  const todayYm = ymOf(todayYmd);
  const isCurrent = targetYm === todayYm;
  const isFuture = targetYm > todayYm;
  const dim = daysInMonth(targetYm);
  const daysElapsed = isCurrent ? Number(todayYmd.slice(8, 10)) : dim;
  const isEarly = isCurrent && daysElapsed < EARLY_MONTH_DAYS;
  // 這個月還沒過完：平常只取每個月 1 號到今天這一天（平常同期），過去的月份整個月比
  const dayOf = (tx) => Number(String(tx.date).slice(8, 10));
  const inPeriod = (tx) => !isCurrent || dayOf(tx) <= daysElapsed;

  const catOf = (tx) => (tx.category && String(tx.category).trim()) || uncategorizedLabel;
  const sumOf = (txs) => txs.reduce((sum, tx) => sum + toValue(tx), 0);

  const monthly = allYms.map((ym) => {
    const txs = byMonth.get(ym);
    // 日常支出＝旅程以外的每一筆（含大額單筆）；旅程另外一段
    const daily = txs.filter((tx) => !isTrip(tx));
    const tripTxs = txs.filter(isTrip);
    return {
      ym,
      dailyTxs: daily,
      daily: sumOf(daily),
      tripTxs,
      trip: sumOf(tripTxs),
      hasRecords: txs.length > 0,
    };
  });
  const target = monthly[monthly.length - 1];
  const allOf = (m) => [...m.dailyTxs, ...m.tripTxs];

  const inBaseline = (m) => !!baseFrom && m.ym >= baseFrom && m.ym < targetYm;
  // 長條圖畫平常那幾個月（沒記帳的月份也畫，是 0）加上目標月份；比分析起點早的不畫
  const inChart = (m) => m === target || inBaseline(m);
  const chartRows = monthly.filter(inChart);
  const baseRows = monthly.filter((m) => m.hasRecords && inBaseline(m));
  const baseYms = baseRows.map((m) => m.ym).reverse();
  const avgOf = (pickTxs) => (baseRows.length
    ? baseRows.reduce((sum, m) => sum + sumOf(pickTxs(m)), 0) / baseRows.length
    : 0);
  const baseTotal = baseRows.reduce((sum, m) => sum + m.daily + m.trip, 0);
  // 平常是 0（那幾個月只有退款之類的負數）就跟沒有平常一樣，不比較
  const baseline = baseRows.length && baseTotal > 0 ? baseTotal / baseRows.length : null;
  // 平常同期：拿來比的金額。過去的月份就是整個月的平常
  const baselineToDate = baseline == null ? null : avgOf((m) => allOf(m).filter(inPeriod));

  // 月底預估 = 已經花的 + 平常在今天之後會花的。不把已經花的照天數放大：買了一雙鞋不代表月底前還會再買。
  // 固定支出這個月已經記了（例如先記好月底的房租），平常剩下日子裡的那一筆就不再算一次
  const seenFixed = new Set(target.dailyTxs.filter((tx) => fixed.has(tx.id)).map(fixedKeyOf));
  const restOf = (txs) => (isCurrent
    ? txs.filter((tx) => !inPeriod(tx) && !(fixed.has(tx.id) && seenFixed.has(fixedKeyOf(tx))))
    : []);
  const toDate = target.daily + target.trip;
  const projected = toDate + avgOf((m) => restOf(allOf(m)));
  // 月初不比：比例留空，畫面改說「第 7 天起開始比」
  const ratio = baselineToDate && !isEarly ? toDate / baselineToDate - 1 : null;
  // 「連續上升」從這個月往回數到平常的下限，只看完整的月份：自動起點跳過的帳本第一個月與沒記帳的月份偏低，
  // 從那裡往上算不是真的變多。跟選幾個月無關
  const trendMonth = (m) => m === target || (m.hasRecords && !!floor && m.ym >= floor && m.ym < targetYm);

  // 分類：本月到目前 vs 該分類的平常同期，依「多花的金額」排序（跟結論句的「主要是哪個分類」同一個標準）。
  // 顯示的金額就是實際花的，點進去看到的明細加起來一樣；走勢線最後一點才用月底預估（虛線）
  const names = new Set();
  for (const m of [target, ...baseRows]) for (const tx of m.dailyTxs) names.add(catOf(tx));
  const categories = [...names].map((name) => {
    const ofCat = (txs) => txs.filter((tx) => catOf(tx) === name);
    const fullSeries = monthly.map((m) => sumOf(ofCat(m.dailyTxs)));
    const current = fullSeries[fullSeries.length - 1];
    const usual = baseline == null ? null : avgOf((m) => ofCat(m.dailyTxs));
    const base = baseline == null ? null : avgOf((m) => ofCat(m.dailyTxs).filter(inPeriod));
    const catProjected = current + avgOf((m) => ofCat(restOf(m.dailyTxs)));
    const trend = [...fullSeries.slice(0, -1), catProjected].filter((_, i) => trendMonth(monthly[i]));
    return {
      name,
      current,
      projected: catProjected,
      usual,
      baseline: base,
      diff: base == null || isEarly ? null : current - base,
      ratio: base && !isEarly ? current / base - 1 : null,
      // 跟 months 對齊的那幾個月（圖表範圍）
      series: fullSeries.filter((_, i) => inChart(monthly[i])),
      risingMonths: isEarly ? 0 : risingStreak(trend),
      txs: ofCat(target.dailyTxs),
    };
  });
  categories.sort((a, b) => (b.diff ?? b.current) - (a.diff ?? a.current));

  // 這個月的旅程：每趟一筆，卡片附註與結論句用（平常的旅程花費算在整體的平常裡）
  const tripTotals = new Map();
  for (const tx of target.tripTxs) {
    const trip = tripOf.get(tx.id);
    if (!tripTotals.has(trip.id)) tripTotals.set(trip.id, { trip, value: 0, txs: [] });
    const row = tripTotals.get(trip.id);
    row.value += toValue(tx);
    row.txs.push(tx);
  }
  const targetTrips = [...tripTotals.values()].sort((a, b) => b.value - a.value);
  // 旅程比平常同期多花多少（平常幾個月也出去玩的話，這趟就不全是多花的）；結論句判斷「主要是旅程」用
  const tripExtra = target.trip - avgOf((m) => m.tripTxs.filter(inPeriod));

  // 正在看的這個月的大額單筆：新 → 舊；同一天的大筆在前。旅程裡的交易歸旅程，不標大額（機票不會同時出現在旅程和大額清單）
  const detected = detectLargeItems(target.dailyTxs, measure, fixed);
  const largeItems = target.dailyTxs.filter((tx) => detected.has(tx.id))
    .sort((a, b) => (a.date === b.date ? twdOf(b) - twdOf(a) : a.date < b.date ? 1 : -1))
    .map((tx) => ({ tx, value: toValue(tx) }));

  return {
    targetYm,
    isCurrent,
    isFuture,
    // 分析起點之前的月份：不分析，不是「還不能比」；isBeforeRecords 是連帳都還沒開始記
    isBeforeStart: !!viewStart && targetYm < viewStart,
    isBeforeRecords: !!firstYm && targetYm < firstYm,
    analysisStartYm: viewStart,
    isEarly,
    daysElapsed,
    daysInMonth: dim,
    months: chartRows,
    toDate,
    projected,
    largeTotal: largeItems.reduce((sum, item) => sum + item.value, 0),
    targetTrips,
    tripExtra,
    baseline,
    baselineToDate,
    baselineMonths: baseYms,
    ratio,
    categories,
    largeItems,
    hasAnyData: !!firstYm,
  };
}
