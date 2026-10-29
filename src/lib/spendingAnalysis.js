/**
 * 消費分析頁的計算（純函式，不碰畫面與資料庫）。
 *
 * 核心規則：
 * 1. 大額單筆另列：學費、一次繳兩個月房租這種一次性大筆會把「這個月花多少」扯歪，
 *    自動找出來另外列，不算進結論、長條圖與分類比較；使用者可以逐筆改回「算進去」。
 *    判斷一律用台幣（twdAmount），換顯示幣別不會改變哪幾筆被抓出來。
 * 2. 固定支出（房租、訂閱、保險這種每個月都付一次的）不是一次性大筆：再大也留在日常支出裡。
 * 3. 平常 = 目標月份之前最近 3 個完整月份的日常支出平均；帳本第一個月多半是月中才開始記，
 *    金額偏低，不算；一筆支出都沒有的月份多半是沒記帳，也不算。不滿 3 個月就用現有的月份，一個都沒有就不比較。
 * 4. 這個月還沒過完時，跟「平常同期」比：近 3 個月各自 1 號到今天這一天花了多少的平均，不把已經花的放大成整個月
 *    （一次買一雙鞋的分類照天數放大，會變成「月底前還會再買」）。月底預估 = 已經花的 + 平常在今天之後會花的。
 *    月初前幾天資料太少，不跟平常比。
 * 5. 旅程（見 lib/trips.js）只從「平常」扣掉：正在看的月份照樣算進去，長條圖另畫一段；
 *    旅程裡的交易不會再被抓成大額單筆，其他筆是不是大額也照「沒有這趟旅程」的日常支出判斷，
 *    跟沒有旅行的月份同一把尺。
 */

export const LARGE_ITEM_RULE = { shareOfMonth: 0.25, minTwd: 10000 };
// 固定支出：前後 3 個月內至少另有 2 個月「剛好出現一次」而且金額跟這筆差不到 30%
export const FIXED_ITEM_RULE = { withinMonths: 3, minOtherMonths: 2, amountTolerance: 0.3 };
export const BASELINE_MONTHS = 3;
export const CHART_MONTHS = 6;
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

/** 目標月份往前推，長條圖要畫的 6 個月（舊 → 新） */
export function chartMonths(targetYm) {
  return Array.from({ length: CHART_MONTHS }, (_, i) => addMonths(targetYm, i - CHART_MONTHS + 1));
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

/**
 * 每個月各自找出大額單筆，回傳交易 id 的 Set。
 *
 * 由大到小檢查：單筆同時「≥ 最低金額」且「≥ 當月支出的一定比例」就抓出來，
 * 從當月總額扣掉後再檢查下一筆。逐筆扣掉是必要的：10 月有一筆 46 萬學費時，
 * 7.7 萬的房租只佔 13%，要先拿掉學費，房租才看得出是一次性大筆（佔剩下的 65%）。
 * exemptIds（固定支出）不會被抓，但仍算在當月總額裡，判斷其他筆的占比時照樣當分母。
 * minTotalByMonth：某些月份的分母至少要這麼多（還沒過完的這個月用平常墊底，月初一筆一萬多才不會占九成被抓）。
 */
export function detectLargeItems(expenses, rule = LARGE_ITEM_RULE, exemptIds = new Set(), minTotalByMonth = {}) {
  const byMonth = new Map();
  for (const tx of expenses || []) {
    const ym = ymOf(tx.date);
    if (!byMonth.has(ym)) byMonth.set(ym, []);
    byMonth.get(ym).push(tx);
  }

  const ids = new Set();
  for (const [ym, txs] of byMonth) {
    const sorted = [...txs].sort((a, b) => twdOf(b) - twdOf(a));
    // 負數（退款、更正）不扣分母，否則分母變小甚至變負，每筆過門檻的都會被抓
    let remaining = Math.max(sorted.reduce((sum, tx) => sum + Math.max(twdOf(tx), 0), 0), minTotalByMonth[ym] ?? 0);
    for (const tx of sorted) {
      if (exemptIds.has(tx.id)) continue;
      const amount = twdOf(tx);
      if (amount < rule.minTwd || amount < remaining * rule.shareOfMonth) break;
      ids.add(tx.id);
      remaining -= amount;
    }
  }
  return ids;
}

/**
 * 「平常」用哪幾個月：目標月份之前最近 3 個月，扣掉帳本第一個月（以及更早、還沒開始記帳的月份）。
 * 回傳新 → 舊。
 */
export function baselineMonths(targetYm, firstYm) {
  if (!firstYm) return [];
  const months = [];
  for (let i = 1; i <= BASELINE_MONTHS; i++) {
    const ym = addMonths(targetYm, -i);
    if (ym > firstYm) months.push(ym);
  }
  return months;
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
 * @param {object[]} params.expenses     支出交易（駝峰形狀，含 id/date/category/itemName/twdAmount）：圖表 6 個月，
 *                                       最好再多前後 3 個月，固定支出才認得出來；窗口外的只用來辨認固定支出
 * @param {string}   params.targetYm     正在看的月份 'YYYY-MM'
 * @param {string}   params.todayYmd     今天 'YYYY-MM-DD'（客戶端日期）
 * @param {string|null} params.firstYm   帳本第一筆交易所在月份；沒有任何交易時為 null
 * @param {Set<string>} [params.includedIds] 使用者改回「算進去」的大額單筆
 * @param {(tx: object) => number} [params.toValue] 單筆換算成顯示幣別的金額，預設用台幣
 * @param {string} [params.uncategorizedLabel]
 * @param {Map<string, {id: string, name: string}>} [params.tripOf] 交易 id → 所屬旅程
 */
export function buildSpendingAnalysis({
  expenses,
  targetYm,
  todayYmd,
  firstYm,
  includedIds = new Set(),
  toValue = twdOf,
  uncategorizedLabel = '',
  tripOf = new Map(),
}) {
  const months = chartMonths(targetYm);
  const inWindow = (expenses || []).filter((tx) => months.includes(ymOf(tx.date)));
  const isTrip = (tx) => tripOf.has(tx.id);
  const notTrip = inWindow.filter((tx) => !isTrip(tx));
  // 固定支出用全部傳進來的交易判斷：只看圖表 6 個月的話，最早幾個月往前比不到，換個月份看結果就會不同
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
  const candidates = baselineMonths(targetYm, firstYm);

  // 旅程裡的交易歸旅程，不參加大額判斷（機票不會同時出現在大額清單），也不算在分母：
  // 放進分母的話，一筆很大的旅程支出會讓同月其他大筆都不到門檻，全部留在日常支出裡
  // 還沒過完的這個月，大額的分母至少用平常（台幣）。每個月各自判斷，之前月份的結果不受這一步影響，
  // 所以先照一般規則抓一次、算出平常，再只重抓這個月
  let detected = detectLargeItems(notTrip, LARGE_ITEM_RULE, fixed);
  if (isCurrent) {
    const pastDaily = candidates
      .map((ym) => notTrip.filter((tx) => ymOf(tx.date) === ym))
      .filter((txs) => txs.length > 0)
      .map((txs) => txs.filter((tx) => !detected.has(tx.id) || includedIds.has(tx.id)).reduce((sum, tx) => sum + twdOf(tx), 0));
    if (pastDaily.length) {
      const floor = pastDaily.reduce((sum, v) => sum + v, 0) / pastDaily.length;
      detected = detectLargeItems(notTrip, LARGE_ITEM_RULE, fixed, { [targetYm]: floor });
    }
  }
  const isExcluded = (tx) => detected.has(tx.id) && !includedIds.has(tx.id);

  const monthly = months.map((ym) => {
    const txs = inWindow.filter((tx) => ymOf(tx.date) === ym);
    const daily = txs.filter((tx) => !isTrip(tx) && !isExcluded(tx));
    const large = txs.filter((tx) => !isTrip(tx) && isExcluded(tx));
    const tripTxs = txs.filter(isTrip);
    return {
      ym,
      dailyTxs: daily,
      daily: sumOf(daily),
      large: sumOf(large),
      tripTxs,
      trip: sumOf(tripTxs),
      hasRecords: txs.length > 0,
      beforeStart: !firstYm || ym < firstYm,
    };
  });
  const target = monthly[monthly.length - 1];

  const baseRows = monthly.filter((m) => m.hasRecords && candidates.includes(m.ym));
  const baseYms = baseRows.map((m) => m.ym).reverse();
  const avgOf = (pickTxs) => (baseRows.length
    ? baseRows.reduce((sum, m) => sum + sumOf(pickTxs(m)), 0) / baseRows.length
    : 0);
  const baseTotal = baseRows.reduce((sum, m) => sum + m.daily, 0);
  // 平常是 0（那幾個月只有另列的大額單筆）就跟沒有平常一樣，不比較
  const baseline = baseRows.length && baseTotal > 0 ? baseTotal / baseRows.length : null;
  // 平常同期：拿來比的金額。過去的月份就是整個月的平常
  const baselineToDate = baseline == null ? null : avgOf((m) => m.dailyTxs.filter(inPeriod));

  // 月底預估 = 已經花的 + 平常在今天之後會花的。不把已經花的照天數放大：買了一雙鞋不代表月底前還會再買。
  // 固定支出這個月已經記了（例如先記好月底的房租），平常剩下日子裡的那一筆就不再算一次
  const seenFixed = new Set(target.dailyTxs.filter((tx) => fixed.has(tx.id)).map(fixedKeyOf));
  const restOf = (m) => (isCurrent
    ? m.dailyTxs.filter((tx) => !inPeriod(tx) && !(fixed.has(tx.id) && seenFixed.has(fixedKeyOf(tx))))
    : []);
  const toDate = target.daily + target.trip;
  const projected = toDate + avgOf(restOf);
  // 月初不比：比例留空，畫面改說「第 7 天起開始比」
  const ratio = baselineToDate && !isEarly ? toDate / baselineToDate - 1 : null;
  // 「連續上升」只看完整的月份：帳本第一個月與沒記帳的月份偏低，從那裡往上算不是真的變多
  const trendMonth = (m) => m === target || (m.hasRecords && !m.beforeStart && m.ym !== firstYm);

  // 分類：本月到目前 vs 該分類的平常同期，依「多花的金額」排序（跟結論句的「主要是哪個分類」同一個標準）。
  // 顯示的金額就是實際花的，點進去看到的明細加起來一樣；走勢線最後一點才用月底預估（虛線）
  const names = new Set();
  for (const m of [target, ...baseRows]) for (const tx of m.dailyTxs) names.add(catOf(tx));
  const categories = [...names].map((name) => {
    const ofCat = (txs) => txs.filter((tx) => catOf(tx) === name);
    const series = monthly.map((m) => sumOf(ofCat(m.dailyTxs)));
    const current = series[series.length - 1];
    const usual = baseline == null ? null : avgOf((m) => ofCat(m.dailyTxs));
    const base = baseline == null ? null : avgOf((m) => ofCat(m.dailyTxs).filter(inPeriod));
    const catProjected = current + avgOf((m) => ofCat(restOf(m)));
    const trend = [...series.slice(0, -1), catProjected].filter((_, i) => trendMonth(monthly[i]));
    return {
      name,
      current,
      projected: catProjected,
      usual,
      baseline: base,
      diff: base == null || isEarly ? null : current - base,
      ratio: base && !isEarly ? current / base - 1 : null,
      series,
      risingMonths: isEarly ? 0 : risingStreak(trend),
      txs: ofCat(target.dailyTxs),
    };
  });
  categories.sort((a, b) => (b.diff ?? b.current) - (a.diff ?? a.current));

  // 這個月的旅程：每趟一列，平常沒有旅程，所以整趟金額就是多花的部分
  const tripTotals = new Map();
  for (const tx of target.tripTxs) {
    const trip = tripOf.get(tx.id);
    if (!tripTotals.has(trip.id)) tripTotals.set(trip.id, { trip, value: 0, txs: [] });
    const row = tripTotals.get(trip.id);
    row.value += toValue(tx);
    row.txs.push(tx);
  }
  const targetTrips = [...tripTotals.values()].sort((a, b) => b.value - a.value);

  const largeItems = inWindow
    .filter((tx) => detected.has(tx.id))
    // 新 → 舊；同一天的大筆在前
    .sort((a, b) => (a.date === b.date ? twdOf(b) - twdOf(a) : a.date < b.date ? 1 : -1))
    .map((tx) => ({ tx, included: includedIds.has(tx.id), value: toValue(tx) }));

  return {
    targetYm,
    isCurrent,
    isFuture,
    // 開始記帳之前的月份：沒有資料，不是「還不能比」
    isBeforeStart: !!firstYm && targetYm < firstYm,
    isEarly,
    daysElapsed,
    daysInMonth: dim,
    months: monthly,
    toDate,
    projected,
    targetLarge: target.large,
    targetTrips,
    baseline,
    baselineToDate,
    baselineMonths: baseYms,
    ratio,
    categories,
    largeItems,
    hasAnyData: !!firstYm,
  };
}
