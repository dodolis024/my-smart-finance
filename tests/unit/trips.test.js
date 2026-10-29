import { describe, it, expect } from 'vitest';
import {
  normalizeTripsSetting,
  buildTripIndex,
  tripEntries,
  summarizeTrips,
  suggestTrips,
  suggestionKey,
  formatTripRange,
} from '@/lib/trips';
import { buildSpendingAnalysis } from '@/lib/spendingAnalysis';

let seq = 0;
const tx = (date, twdAmount, { category = '飲食', itemName = 'x', currency = 'GBP', type = 'expense', time, subscriptionId = null } = {}) =>
  ({ id: `t${++seq}`, date, time, twdAmount, category, itemName, currency, type, subscriptionId });
const trip = (over = {}) => ({ id: 'trip1', name: '比利時', start: '2026-09-20', end: '2026-09-26', excludedIds: [], includedIds: [], ...over });

describe('normalizeTripsSetting', () => {
  it('沒有設定時回傳空的', () => {
    expect(normalizeTripsSetting(null)).toEqual({ trips: [], dismissed: [] });
  });

  it('略過壞掉的旅程、補齊缺的清單', () => {
    const s = normalizeTripsSetting({
      trips: [{ id: 'a', name: ' 比利時 ', start: '2026-09-20', end: '2026-09-26' }, { id: 'b', start: 'bad', end: '2026-01-01' }, null],
      dismissed: ['EUR:2026-09-24:2026-09-26', 3],
    });
    expect(s.trips).toEqual([{ id: 'a', name: '比利時', start: '2026-09-20', end: '2026-09-26', excludedIds: [], includedIds: [] }]);
    expect(s.dismissed).toEqual(['EUR:2026-09-24:2026-09-26']);
  });
});

describe('哪些交易算進旅程', () => {
  const inRange = tx('2026-09-24', 834);
  const before = tx('2026-09-19', 1551);
  const flight = tx('2026-08-01', 4763);
  const excluded = tx('2026-09-21', 1782);
  const rent = tx('2026-09-22', 15000, { category: '居住', itemName: '房租' });
  const income = tx('2026-09-25', 50000, { type: 'income' });
  const rows = [inRange, before, flight, excluded, rent, income];
  const t1 = trip({ excludedIds: [excluded.id, rent.id], includedIds: [flight.id] });

  it('日期範圍內＋手動加入的；排除的（例如旅途中扣的房租）、收入都不算', () => {
    const index = buildTripIndex([t1], rows);
    expect([...index.keys()].sort()).toEqual([inRange.id, flight.id].sort());
  });

  it('明細列出每一筆的狀態，日期新 → 舊', () => {
    const index = buildTripIndex([t1], rows);
    const entries = tripEntries(t1, rows, index);
    expect(entries.map((e) => [e.tx.id, e.status])).toEqual([
      [inRange.id, 'in'], [rent.id, 'excluded'], [excluded.id, 'excluded'], [flight.id, 'added'],
    ]);
  });

  it('在較早那趟排除的，落到重疊的另一趟時，原本那趟仍顯示已排除、可以加回', () => {
    const a = trip({ id: 'a', name: 'A', start: '2026-09-20', end: '2026-09-26', excludedIds: [inRange.id] });
    const b = trip({ id: 'b', name: 'B', start: '2026-09-24', end: '2026-09-30' });
    const index = buildTripIndex([a, b], [inRange]);
    expect(index.get(inRange.id).id).toBe('b');
    expect(tripEntries(a, [inRange], index)[0].status).toBe('excluded');
  });

  it('兩趟日期重疊：歸開始日早的那趟，另一趟顯示 other', () => {
    const a = trip({ id: 'a', name: 'A', start: '2026-09-20', end: '2026-09-25' });
    const b = trip({ id: 'b', name: 'B', start: '2026-09-24', end: '2026-09-30' });
    const index = buildTripIndex([b, a], [inRange]);
    expect(index.get(inRange.id).id).toBe('a');
    expect(tripEntries(b, [inRange], index)[0]).toMatchObject({ status: 'other', otherTrip: { id: 'a' } });
  });

  it('手動加入的優先，即使落在另一趟的日期內', () => {
    const a = trip({ id: 'a', start: '2026-09-20', end: '2026-09-25' });
    const b = trip({ id: 'b', start: '2026-09-28', end: '2026-09-30', includedIds: [inRange.id] });
    expect(buildTripIndex([a, b], [inRange]).get(inRange.id).id).toBe('b');
  });

  it('總額、筆數、排除筆數、分類由大到小；旅程新到舊', () => {
    const older = trip({ id: 'old', name: '舊', start: '2026-03-01', end: '2026-03-02' });
    const index = buildTripIndex([older, t1], rows);
    const [first, second] = summarizeTrips([older, t1], rows, index, { toValue: (r) => r.twdAmount });
    expect(first.trip.id).toBe('trip1');
    expect(first).toMatchObject({ total: 834 + 4763, count: 2, excludedCount: 2 });
    expect(first.categories).toEqual([{ name: '飲食', value: 834 + 4763 }]);
    expect(second).toMatchObject({ total: 0, count: 0 });
  });
});

describe('suggestTrips', () => {
  const gbp = (date) => tx(date, 300);
  const eur = (date) => tx(date, 300, { currency: 'EUR' });
  // 平常 7–9 月幾乎天天用英鎊（外幣只佔少數天，才不會被當成平常用的幣別）
  const usual = Array.from({ length: 60 }, (_, i) => gbp(`2026-${i < 30 ? '07' : '08'}-${String((i % 30) + 1).padStart(2, '0')}`));

  it('連續 2 天以上、至少 3 筆的外幣才提示；零星的不提示', () => {
    const rows = [...usual, eur('2026-09-20'), eur('2026-09-24'), eur('2026-09-24'), eur('2026-09-25'), eur('2026-09-26'),
      tx('2026-07-21', 100, { currency: 'USD' }), tx('2026-07-21', 100, { currency: 'USD' })];
    const result = suggestTrips(rows, [], []);
    expect(result).toEqual([{ currency: 'EUR', start: '2026-09-24', end: '2026-09-26', count: 4, key: 'EUR:2026-09-24:2026-09-26' }]);
  });

  it('連續但只有 2 筆不提示', () => {
    expect(suggestTrips([...usual, eur('2026-09-24'), eur('2026-09-25')], [], [])).toEqual([]);
  });

  it('跟現有旅程重疊、或按過「不是旅程」的不再提示', () => {
    const rows = [...usual, eur('2026-09-24'), eur('2026-09-25'), eur('2026-09-26')];
    const [s] = suggestTrips(rows, [], []);
    expect(suggestTrips(rows, [trip()], [])).toEqual([]);
    expect(suggestTrips(rows, [], [suggestionKey(s)])).toEqual([]);
  });

  it('按過「不是旅程」後，同一段多記一天也不會又跳出來', () => {
    const rows = [...usual, eur('2026-09-24'), eur('2026-09-25'), eur('2026-09-26')];
    const [s] = suggestTrips(rows, [], []);
    expect(suggestTrips([...rows, eur('2026-09-27')], [], [suggestionKey(s)])).toEqual([]);
  });

  // 好幾個外幣訂閱剛好扣在相鄰兩天
  const subsOf = (subscriptionId) => ['06', '07', '08', '09'].flatMap((m) => [
    tx(`2026-${m}-05`, 300, { currency: 'USD', category: '訂閱', itemName: 'Spotify', subscriptionId: subscriptionId && 's1' }),
    tx(`2026-${m}-06`, 500, { currency: 'USD', category: '訂閱', itemName: 'ChatGPT', subscriptionId: subscriptionId && 's2' }),
    tx(`2026-${m}-06`, 400, { currency: 'USD', category: '訂閱', itemName: 'Netflix', subscriptionId: subscriptionId && 's3' }),
  ]);

  it('訂閱管理自動記的外幣扣款，剛好連續幾天也不算旅程', () => {
    expect(suggestTrips([...usual, ...subsOf(true)], [], [])).toEqual([]);
  });

  it('自己手動記的外幣訂閱分不出來，連續幾天就會提示（規則只看訂閱管理）', () => {
    expect(suggestTrips([...usual, ...subsOf(false)], [], [])).toHaveLength(4);
  });

  it('搬到國外換了幣別：兩個幣別都常用，都不當成旅程', () => {
    const twd = Array.from({ length: 30 }, (_, i) => tx(`2026-06-${String(i + 1).padStart(2, '0')}`, 100, { currency: 'TWD' }));
    expect(suggestTrips([...twd, ...usual], [], [])).toEqual([]);
  });

  it('跨月的連續天數也接得起來', () => {
    const rows = [...usual, eur('2026-09-30'), eur('2026-10-01'), eur('2026-10-01')];
    expect(suggestTrips(rows, [], [])[0]).toMatchObject({ start: '2026-09-30', end: '2026-10-01', count: 3 });
  });

  it('平常的幣別是用得最多的那個：住台灣的人去日本，日圓才是外幣', () => {
    const twd = Array.from({ length: 28 }, (_, i) => tx(`2026-08-${String(i + 1).padStart(2, '0')}`, 100, { currency: 'TWD' }));
    const jpy = ['2026-09-10', '2026-09-11', '2026-09-11'].map((d) => tx(d, 100, { currency: 'JPY' }));
    expect(suggestTrips([...twd, ...jpy], [], [])[0]).toMatchObject({ currency: 'JPY' });
  });
});

describe('formatTripRange', () => {
  it('今年只寫月日；不是今年或跨年帶年份', () => {
    expect(formatTripRange('2026-09-20', '2026-09-26', 2026)).toBe('9/20 – 9/26');
    expect(formatTripRange('2025-12-28', '2026-01-03', 2026)).toBe('2025/12/28 – 2026/1/3');
    expect(formatTripRange('2025-05-01', '2025-05-03', 2026)).toBe('2025/5/1 – 2025/5/3');
    expect(formatTripRange('2026-05-01', '2026-05-01', 2026)).toBe('5/1');
  });
});

describe('旅程對消費分析的影響', () => {
  // 7–8 月每月日常 1 萬（帳本 6 月開始），9 月日常 1 萬＋比利時 2 萬
  const daily = (ym) => Array.from({ length: 10 }, (_, i) => tx(`${ym}-${String(i + 1).padStart(2, '0')}`, 1000));
  const belgium = [tx('2026-09-24', 12000, { category: '旅遊', itemName: '飯店' }), tx('2026-09-25', 8000, { itemName: '晚餐' })];
  const t1 = trip({ start: '2026-09-24', end: '2026-09-26' });
  const rows = [...daily('2026-07'), ...daily('2026-08'), ...daily('2026-09'), ...belgium];
  const tripOf = buildTripIndex([t1], rows);
  const base = { expenses: rows, firstYm: '2026-06', tripOf };

  it('看旅行那個月：總額含旅程、跟平常比，長條另一段，分類不含旅程', () => {
    const a = buildSpendingAnalysis({ ...base, targetYm: '2026-09', todayYmd: '2026-10-27' });
    expect(a.baseline).toBe(10000);
    expect(a.toDate).toBe(30000);
    expect(a.ratio).toBeCloseTo(2);
    expect(a.months.at(-1)).toMatchObject({ daily: 10000, trip: 20000 });
    expect(a.targetTrips).toEqual([expect.objectContaining({ trip: t1, value: 20000 })]);
    expect(a.categories.map((c) => c.name)).toEqual(['飲食']);
  });

  it('看下個月：平常照實際花的算，旅程也算在內；有沒有建旅程，平常都一樣', () => {
    const withTrip = buildSpendingAnalysis({ ...base, targetYm: '2026-10', todayYmd: '2026-10-31' });
    const without = buildSpendingAnalysis({ ...base, tripOf: new Map(), targetYm: '2026-10', todayYmd: '2026-10-31' });
    expect(withTrip.baseline).toBeCloseTo(50000 / 3);
    expect(without.baseline).toBeCloseTo(50000 / 3);
    // 各分類的平常不含旅程（旅程在分類清單整趟算一列）
    expect(withTrip.categories.find((c) => c.name === '旅遊')).toBeUndefined();
  });

  it('結論句判斷「主要是旅程」只看這趟比平常的旅程多花多少', () => {
    // 9 月的比利時：平常（7、8 月）沒有旅程 → 整趟 2 萬都是多出來的
    const sep = buildSpendingAnalysis({ ...base, targetYm: '2026-09', todayYmd: '2026-10-27' });
    expect(sep.tripExtra).toBe(20000);
    // 10 月再去一趟 2 萬：平常（7–9 月）平均每月旅程 2 萬 / 3，多出來的只有 2 萬 × 2/3
    const again = [tx('2026-10-05', 20000, { itemName: '東京' })];
    const t2 = trip({ id: 't2', start: '2026-10-05', end: '2026-10-05' });
    const all = [...rows, ...again];
    const oct = buildSpendingAnalysis({ expenses: all, firstYm: '2026-06', tripOf: buildTripIndex([t1, t2], all), targetYm: '2026-10', todayYmd: '2026-10-31' });
    expect(oct.tripExtra).toBeCloseTo(20000 - 20000 / 3);
  });

  it('旅程裡的大筆不會再被抓成大額單筆', () => {
    const without = buildSpendingAnalysis({ ...base, tripOf: new Map(), targetYm: '2026-09', todayYmd: '2026-10-27' });
    expect(without.largeItems.map((i) => i.tx.id)).toContain(belgium[0].id);
    const a = buildSpendingAnalysis({ ...base, targetYm: '2026-09', todayYmd: '2026-10-27' });
    expect(a.largeItems).toEqual([]);
  });

  it('月中正在旅行：旅程照實際金額算一次，跟平常同期比', () => {
    const a = buildSpendingAnalysis({ ...base, targetYm: '2026-09', todayYmd: '2026-09-25' });
    // 平常 7、8 月都在 1–10 號花完 → 同期 1 萬、之後 0
    expect(a.baselineToDate).toBe(10000);
    expect(a.projected).toBe(30000);
    expect(a.ratio).toBeCloseTo(2);
  });

  it('剛旅行回來：旅程不放大，月底預估 = 已經花的 + 平常之後會花的', () => {
    // 10/1–10/10 旅行每天 5,000；10/11–10/15 日常每天 1,000；今天 10/15
    const tripRows = Array.from({ length: 10 }, (_, i) => tx(`2026-10-${String(i + 1).padStart(2, '0')}`, 5000, { itemName: `trip${i}` }));
    const home = Array.from({ length: 5 }, (_, i) => tx(`2026-10-${11 + i}`, 1000, { itemName: `home${i}` }));
    const t2 = trip({ id: 't2', start: '2026-10-01', end: '2026-10-10' });
    const all = [...daily('2026-07'), ...daily('2026-08'), ...tripRows, ...home];
    const a = buildSpendingAnalysis({ expenses: all, firstYm: '2026-06', tripOf: buildTripIndex([t2], all), targetYm: '2026-10', todayYmd: '2026-10-15' });
    expect(a.toDate).toBe(55000);
    expect(a.projected).toBe(55000);
  });

  it('同月有很大的旅程支出，其他大筆照樣標成大額', () => {
    const laptop = tx('2026-09-15', 12000, { category: '購物', itemName: '筆電' });
    const huge = tx('2026-09-25', 500000, { itemName: '旅程裡的大筆' });
    const all = [...daily('2026-07'), ...daily('2026-08'), ...Array.from({ length: 6 }, (_, i) => tx(`2026-09-0${i + 1}`, 5000)), huge, laptop];
    const a = buildSpendingAnalysis({ expenses: all, firstYm: '2026-06', targetYm: '2026-09', todayYmd: '2026-10-27', tripOf: buildTripIndex([t1], all) });
    expect(a.largeItems.map((i) => i.tx.id)).toEqual([laptop.id]);
    expect(a.months.at(-1)).toMatchObject({ daily: 42000, trip: 500000 });
  });
});
