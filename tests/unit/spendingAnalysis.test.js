import { describe, it, expect } from 'vitest';
import {
  addMonths,
  monthGap,
  detectFixedItems,
  daysInMonth,
  chartMonths,
  detectLargeItems,
  baselineMonths,
  risingStreak,
  buildSpendingAnalysis,
  EARLY_MONTH_DAYS,
} from '@/lib/spendingAnalysis';

let seq = 0;
const tx = (date, twdAmount, category = '飲食', itemName) => ({ id: `t${++seq}`, date, twdAmount, category, itemName, type: 'expense' });

describe('月份小工具', () => {
  it('monthGap', () => {
    expect(monthGap('2026-01', '2025-11')).toBe(2);
    expect(monthGap('2026-05', '2026-08')).toBe(-3);
  });

  it('addMonths 跨年', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2025-11', 3)).toBe('2026-02');
    expect(addMonths('2026-10', -5)).toBe('2026-05');
  });

  it('daysInMonth 含閏年二月', () => {
    expect(daysInMonth('2026-10')).toBe(31);
    expect(daysInMonth('2028-02')).toBe(29);
  });

  it('chartMonths 是舊到新的 6 個月', () => {
    expect(chartMonths('2026-02')).toEqual(['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('risingStreak 只算尾端連續上升', () => {
    expect(risingStreak([5, 1, 2, 3])).toBe(2);
    expect(risingStreak([3, 2, 1])).toBe(0);
    expect(risingStreak([1])).toBe(0);
  });
});

describe('detectLargeItems', () => {
  it('先拿掉最大筆再檢查下一筆：學費之後，房租也看得出是一次性大筆', () => {
    const tuition = tx('2026-10-14', 467725, '上學');
    const rent = tx('2026-10-23', 77511, '生活');
    const food = Array.from({ length: 20 }, (_, i) => tx(`2026-10-${String(i + 1).padStart(2, '0')}`, 2000));
    const ids = detectLargeItems([tuition, rent, ...food]);
    expect(ids).toEqual(new Set([tuition.id, rent.id]));
  });

  it('單筆占比高但沒達最低金額，不算大額（小月份的一筆咖啡不會被抓）', () => {
    const coffee = tx('2026-08-02', 150);
    expect(detectLargeItems([coffee]).size).toBe(0);
  });

  it('金額超過最低門檻但只占當月一小部分，不算大額（9 千的電鍋）', () => {
    const cooker = tx('2026-09-03', 9049, '生活');
    const big = tx('2026-09-05', 12000, '生活');
    const rest = Array.from({ length: 30 }, (_, i) => tx(`2026-09-${String(i + 1).padStart(2, '0')}`, 2000));
    const ids = detectLargeItems([cooker, big, ...rest]);
    expect(ids.has(cooker.id)).toBe(false);
    expect(ids.has(big.id)).toBe(false);
  });

  it('固定支出不會被抓，但仍算在當月總額裡', () => {
    const rent = tx('2026-10-05', 12000, '居住', '房租');
    const phone = tx('2026-10-18', 32900, '購物', 'iPhone');
    const rest = Array.from({ length: 20 }, (_, i) => tx(`2026-10-${String(i + 1).padStart(2, '0')}`, 1000));
    const ids = detectLargeItems([rent, phone, ...rest], undefined, new Set([rent.id]));
    expect(ids).toEqual(new Set([phone.id]));
    // 房租是最大筆、被跳過之後，下一筆照樣要檢查（不能直接停）
    const ids2 = detectLargeItems([tx('2026-11-05', 50000, '居住', '房租'), tx('2026-11-06', 30000, '購物', '筆電')], undefined, new Set());
    expect(ids2.size).toBe(2);
  });

  it('每個月分開判斷', () => {
    const sep = tx('2026-09-10', 30000);
    const oct = Array.from({ length: 10 }, (_, i) => tx(`2026-10-${String(i + 1).padStart(2, '0')}`, 20000));
    // 9 月只有這一筆 → 是大額；10 月十筆一樣大，各占 10% → 都不是
    const ids = detectLargeItems([sep, ...oct]);
    expect(ids).toEqual(new Set([sep.id]));
  });
});

describe('detectFixedItems', () => {
  it('每個月付一次、金額差不多的是固定支出', () => {
    const rent = ['2026-07-05', '2026-08-05', '2026-09-05', '2026-10-05'].map((d) => tx(d, 12000, '居住', '房租'));
    expect(detectFixedItems(rent)).toEqual(new Set(rent.map((r) => r.id)));
  });

  it('一個月出現很多次的（每天的便當）不是固定支出', () => {
    const lunch = ['07', '08', '09'].flatMap((m) => [tx(`2026-${m}-02`, 100, '飲食', '便當'), tx(`2026-${m}-03`, 100, '飲食', '便當')]);
    expect(detectFixedItems(lunch).size).toBe(0);
  });

  it('同名但金額突然暴增的那一筆不算固定（平常 2 千的 Uniqlo，某月買了 1.5 萬）', () => {
    const a = tx('2026-07-10', 2000, '購物', 'Uniqlo');
    const b = tx('2026-08-10', 2100, '購物', 'Uniqlo');
    const c = tx('2026-09-10', 1900, '購物', 'Uniqlo');
    const spike = tx('2026-10-10', 15000, '購物', 'Uniqlo');
    const ids = detectFixedItems([a, b, c, spike]);
    expect(ids.has(spike.id)).toBe(false);
    expect(ids.has(a.id)).toBe(true);
  });

  it('只有另一個月出現過，還不夠認定', () => {
    const rows = [tx('2026-09-05', 12000, '居住', '房租'), tx('2026-10-05', 12000, '居住', '房租')];
    expect(detectFixedItems(rows).size).toBe(0);
  });

  it('前後都看：最早的月份靠之後的月份認出來', () => {
    const rows = ['2026-05-05', '2026-06-05', '2026-07-05'].map((d) => tx(d, 12000, '居住', '房租'));
    expect(detectFixedItems(rows).has(rows[0].id)).toBe(true);
  });

  it('隔太遠的月份不算（超過前後 3 個月）', () => {
    const rows = [tx('2026-01-05', 5000, '保險', '年繳保費'), tx('2026-05-05', 5000, '保險', '年繳保費'), tx('2026-09-05', 5000, '保險', '年繳保費')];
    expect(detectFixedItems(rows).size).toBe(0);
  });

  it('沒有名稱無從比對；同名不同分類分開看；名稱忽略大小寫與空白', () => {
    const noName = ['07', '08', '09'].map((m) => tx(`2026-${m}-05`, 500, '訂閱'));
    const netflix = [tx('2026-07-01', 390, '訂閱', 'Netflix'), tx('2026-08-01', 390, '訂閱', ' netflix '), tx('2026-09-01', 390, '娛樂', 'Netflix')];
    const ids = detectFixedItems([...noName, ...netflix]);
    expect(noName.some((r) => ids.has(r.id))).toBe(false);
    // 訂閱類只有 7、8 月兩筆（9 月那筆分類不同），彼此只各有一個「其他月份」→ 不夠
    expect(netflix.some((r) => ids.has(r.id))).toBe(false);
  });
});

describe('baselineMonths', () => {
  it('最近 3 個月，扣掉帳本第一個月', () => {
    expect(baselineMonths('2026-10', '2026-07')).toEqual(['2026-09', '2026-08']);
    expect(baselineMonths('2026-10', '2026-01')).toEqual(['2026-09', '2026-08', '2026-07']);
  });

  it('還沒有完整月份就是空的', () => {
    expect(baselineMonths('2026-10', '2026-10')).toEqual([]);
    expect(baselineMonths('2026-10', '2026-09')).toEqual([]);
    expect(baselineMonths('2026-10', null)).toEqual([]);
  });
});

describe('buildSpendingAnalysis', () => {
  // 照使用者 2026 年真實帳本的形狀：7 月只有出國前的三筆大額，8 月開始天天記
  function realisticLedger() {
    const july = [tx('2026-07-21', 49298, '上學'), tx('2026-07-24', 31697, '上學'), tx('2026-07-21', 23629, '上學')];
    const aug = [tx('2026-08-20', 8000, '生活'), tx('2026-08-25', 8013, '飲食')];
    const sep = [tx('2026-09-03', 9049, '生活'), ...Array.from({ length: 21 }, (_, i) => tx(`2026-09-${String(i + 5).padStart(2, '0')}`, 3032, '飲食'))];
    const tuition = tx('2026-10-14', 467725, '上學');
    const rent = tx('2026-10-23', 77511, '生活');
    const oct = [tuition, rent, ...Array.from({ length: 21 }, (_, i) => tx(`2026-10-${String(i + 1).padStart(2, '0')}`, 2005.33, '飲食'))];
    return { all: [...july, ...aug, ...sep, ...oct], tuition, rent };
  }

  it('大額另列、帳本第一個月不算進平常、月中用推估值比', () => {
    const { all, tuition, rent } = realisticLedger();
    const a = buildSpendingAnalysis({ expenses: all, targetYm: '2026-10', todayYmd: '2026-10-27', firstYm: '2026-07' });

    expect(a.isCurrent).toBe(true);
    expect(a.baselineMonths).toEqual(['2026-09', '2026-08']);
    expect(a.baseline).toBeCloseTo((16013 + 9049 + 21 * 3032) / 2, 0);
    expect(a.toDate).toBeCloseTo(21 * 2005.33, 1);
    expect(a.projected).toBeCloseTo((21 * 2005.33 * 31) / 27, 1);
    expect(a.targetLarge).toBeCloseTo(467725 + 77511, 0);
    expect(a.largeItems.map((l) => l.tx.id)).toEqual(expect.arrayContaining([tuition.id, rent.id]));
    // 長條圖的 10 月不含那兩筆
    expect(a.months.at(-1).daily).toBeCloseTo(a.toDate, 6);
  });

  it('使用者把某筆改回算進去，它就回到日常支出', () => {
    const { all, rent } = realisticLedger();
    const a = buildSpendingAnalysis({
      expenses: all, targetYm: '2026-10', todayYmd: '2026-10-27', firstYm: '2026-07', includedIds: new Set([rent.id]),
    });
    expect(a.toDate).toBeCloseTo(21 * 2005.33 + 77511, 1);
    expect(a.targetLarge).toBeCloseTo(467725, 0);
    expect(a.largeItems.find((l) => l.tx.id === rent.id).included).toBe(true);
  });

  it('改回算進去的大額單筆，月底推估只算一次，不照每天的速度放大', () => {
    const { all, tuition } = realisticLedger();
    const a = buildSpendingAnalysis({
      expenses: all, targetYm: '2026-10', todayYmd: '2026-10-27', firstYm: '2026-07', includedIds: new Set([tuition.id]),
    });
    const everyday = 21 * 2005.33;
    expect(a.toDate).toBeCloseTo(everyday + 467725, 1);
    expect(a.projected).toBeCloseTo((everyday * 31) / 27 + 467725, 1);
    const school = a.categories.find((c) => c.name === '上學');
    expect(school.projected).toBeCloseTo(467725, 1);
  });

  it('過去的月份不推估', () => {
    const { all } = realisticLedger();
    const a = buildSpendingAnalysis({ expenses: all, targetYm: '2026-09', todayYmd: '2026-10-27', firstYm: '2026-07' });
    expect(a.isCurrent).toBe(false);
    expect(a.projected).toBe(a.toDate);
    expect(a.baselineMonths).toEqual(['2026-08']);
  });

  it('還沒有完整月份可比時，平常與比例是 null', () => {
    const a = buildSpendingAnalysis({
      expenses: [tx('2026-10-03', 500)], targetYm: '2026-10', todayYmd: '2026-10-10', firstYm: '2026-10',
    });
    expect(a.baseline).toBeNull();
    expect(a.ratio).toBeNull();
    expect(a.categories[0].diff).toBeNull();
  });

  it('沒有任何交易', () => {
    const a = buildSpendingAnalysis({ expenses: [], targetYm: '2026-10', todayYmd: '2026-10-10', firstYm: null });
    expect(a.hasAnyData).toBe(false);
    expect(a.toDate).toBe(0);
    expect(a.categories).toEqual([]);
  });

  it('未來的月份標記 isFuture', () => {
    const a = buildSpendingAnalysis({ expenses: [], targetYm: '2026-12', todayYmd: '2026-10-10', firstYm: '2026-01' });
    expect(a.isFuture).toBe(true);
  });

  it('分類依多花的金額排序，並算出連續上升的月數', () => {
    const rows = [
      // 飲食：7、8、9 月 1000 → 10 月推估 3000（多 2000）
      tx('2026-07-05', 1000, '飲食'), tx('2026-08-05', 1000, '飲食'), tx('2026-09-05', 1000, '飲食'),
      tx('2026-10-05', 1500, '飲食'),
      // 交通：每月 3000 → 10 月推估 1000（少 2000）
      tx('2026-07-06', 3000, '交通'), tx('2026-08-06', 3000, '交通'), tx('2026-09-06', 3000, '交通'),
      tx('2026-10-06', 500, '交通'),
      // 娛樂：7 月 0 → 8 → 9 → 10 月一路上升（帳本 6 月就開始，7 月的 0 是真的沒花）
      tx('2026-08-07', 100, '娛樂'), tx('2026-09-07', 200, '娛樂'), tx('2026-10-07', 400, '娛樂'),
    ];
    // 10/15 → 推估倍數 31/15
    const a = buildSpendingAnalysis({ expenses: rows, targetYm: '2026-10', todayYmd: '2026-10-15', firstYm: '2026-06' });
    expect(a.categories.map((c) => c.name)).toEqual(['飲食', '娛樂', '交通']);
    const food = a.categories[0];
    expect(food.baseline).toBe(1000);
    expect(food.diff).toBeCloseTo((1500 * 31) / 15 - 1000, 6);
    expect(a.categories[1].risingMonths).toBe(3);
    expect(food.txs).toHaveLength(1);
  });

  it('金額走顯示幣別換算，大額判斷仍看台幣', () => {
    const big = tx('2026-10-02', 40000, '上學');
    const small = tx('2026-10-03', 4000, '飲食');
    const a = buildSpendingAnalysis({
      expenses: [big, small], targetYm: '2026-09', todayYmd: '2026-10-27', firstYm: '2026-01',
      toValue: (t) => t.twdAmount / 40,
    });
    expect(a.months.at(-1).ym).toBe('2026-09');
    const b = buildSpendingAnalysis({
      expenses: [big, small], targetYm: '2026-10', todayYmd: '2026-10-31', firstYm: '2026-01',
      toValue: (t) => t.twdAmount / 40,
    });
    expect(b.largeItems.map((l) => l.tx.id)).toEqual([big.id]);
    expect(b.toDate).toBeCloseTo(100, 6);
    expect(b.largeItems[0].value).toBeCloseTo(1000, 6);
  });

  it('空白分類歸到未分類', () => {
    const a = buildSpendingAnalysis({
      expenses: [{ ...tx('2026-10-03', 300), category: '  ' }], targetYm: '2026-10', todayYmd: '2026-10-31', firstYm: '2026-01',
      uncategorizedLabel: '未分類',
    });
    expect(a.categories[0].name).toBe('未分類');
  });
});

describe('一般用戶的帳：房租與訂閱是固定支出', () => {
  // 台北上班族：房租每月 5 號 12,000、Netflix 每月 1 號 390，日常消費每月約 2 萬；10 月換手機
  function ledger(lastDay = 31) {
    const rows = [];
    for (const m of ['05', '06', '07', '08', '09', '10']) {
      const end = m === '10' ? lastDay : daysInMonth(`2026-${m}`);
      if (m !== '10' || lastDay >= 5) rows.push(tx(`2026-${m}-05`, 12000, '居住', '房租'));
      if (m !== '10' || lastDay >= 1) rows.push(tx(`2026-${m}-01`, 390, '訂閱', 'Netflix'));
      for (let d = 1; d <= end; d++) rows.push(tx(`2026-${m}-${String(d).padStart(2, '0')}`, 700, '飲食', '午餐'));
    }
    return rows;
  }

  it('房租不會被當成大額單筆，留在日常支出；手機照樣另列', () => {
    const rows = ledger(27);
    const phone = tx('2026-10-18', 32900, '購物', 'iPhone 17');
    const a = buildSpendingAnalysis({ expenses: [...rows, phone], targetYm: '2026-10', todayYmd: '2026-10-27', firstYm: '2026-03' });
    expect(a.largeItems.map((l) => l.tx.id)).toEqual([phone.id]);
    expect(a.toDate).toBe(12000 + 390 + 27 * 700);
  });

  it('月底推估：房租與訂閱只算一次，只有午餐照速度放大', () => {
    const a = buildSpendingAnalysis({ expenses: ledger(27), targetYm: '2026-10', todayYmd: '2026-10-27', firstYm: '2026-03' });
    expect(a.projected).toBeCloseTo(12000 + 390 + (27 * 700 * 31) / 27, 6);
    const subs = a.categories.find((c) => c.name === '訂閱');
    expect(subs.ratio).toBeCloseTo(0, 6);
    expect(a.pendingFixed).toEqual([]);
  });

  it('月初房租還沒付：照上個月的金額先算進月底預估', () => {
    const a = buildSpendingAnalysis({ expenses: ledger(3), targetYm: '2026-10', todayYmd: '2026-10-03', firstYm: '2026-03' });
    expect(a.pendingFixed.map((p) => p.tx.itemName)).toEqual(['房租']);
    expect(a.projected).toBeCloseTo(390 + 12000 + (3 * 700 * 31) / 3, 6);
    const housing = a.categories.find((c) => c.name === '居住');
    expect(housing.current).toBe(0);
    expect(housing.projected).toBe(12000);
    expect(housing.ratio).toBeCloseTo(0, 6);
    // 月初還不至於被說成多花很多或少花很多
    expect(Math.abs(a.ratio)).toBeLessThan(0.05);
  });

  it('付款日已經過了還沒出現，不自動補（可能退租或改了日子）', () => {
    const rows = ledger(3);
    const a = buildSpendingAnalysis({ expenses: rows, targetYm: '2026-10', todayYmd: '2026-10-08', firstYm: '2026-03' });
    expect(a.pendingFixed).toEqual([]);
  });

  it('看過去的月份不補還沒付的固定支出', () => {
    const rows = ledger(31).filter((r) => !(r.itemName === '房租' && r.date === '2026-09-05'));
    const a = buildSpendingAnalysis({ expenses: rows, targetYm: '2026-09', todayYmd: '2026-10-27', firstYm: '2026-03' });
    expect(a.pendingFixed).toEqual([]);
    expect(a.projected).toBe(a.toDate);
  });
});

describe('審查後修正的邊界情況', () => {
  it('負數（退款）不會把分母拉低，害一般大筆被抓成大額', () => {
    // 正數共 7.6 萬：3 萬抓出來後剩 4.6 萬，1 萬只占 22%，不抓。
    // 如果 -2.5 萬也扣分母，剩下只有 2.1 萬，1 萬占 48% 就會被誤抓
    const rows = [tx('2026-08-02', 30000), tx('2026-08-03', 10000), tx('2026-08-04', 9000), tx('2026-08-05', 9000),
      tx('2026-08-06', 9000), tx('2026-08-07', 9000), tx('2026-08-08', -25000)];
    const ids = detectLargeItems(rows);
    expect(ids.has(rows[0].id)).toBe(true);
    expect(ids.has(rows[1].id)).toBe(false);
  });

  it('一筆都沒記的月份不算進平常', () => {
    const rows = [tx('2026-07-10', 9000), tx('2026-08-10', 9000), tx('2026-10-10', 9000)];
    const a = buildSpendingAnalysis({ expenses: rows, targetYm: '2026-10', todayYmd: '2026-11-02', firstYm: '2026-06' });
    expect(a.baselineMonths).toEqual(['2026-08', '2026-07']);
    expect(a.baseline).toBe(9000);
    expect(a.ratio).toBe(0);
  });

  it('連續上升不從帳本第一個月或沒記帳的月份起算', () => {
    const rows = [tx('2026-08-20', 2000), tx('2026-09-10', 8000), tx('2026-10-10', 9000)];
    const a = buildSpendingAnalysis({ expenses: rows, targetYm: '2026-10', todayYmd: '2026-11-02', firstYm: '2026-08' });
    expect(a.categories[0].risingMonths).toBe(1);
  });

  it('平常是 0（那幾個月只有另列的大額單筆）就不比較', () => {
    const rows = [tx('2026-09-10', 50000, '學費', '學費'), tx('2026-10-10', 9000)];
    const a = buildSpendingAnalysis({ expenses: rows, targetYm: '2026-10', todayYmd: '2026-11-02', firstYm: '2026-08' });
    expect(a.baseline).toBeNull();
    expect(a.ratio).toBeNull();
  });

  it('圖表窗口外的月份也拿來認固定支出：最早一個月的房租不會因為往前看不到就被當成大額', () => {
    const rent = (date) => tx(date, 15000, '居住', '房租');
    const rows = [
      rent('2026-02-01'), rent('2026-03-01'), rent('2026-04-01'), rent('2026-05-01'),
      tx('2026-05-12', 3000), rent('2026-06-01'), rent('2026-07-01'), rent('2026-08-01'),
      rent('2026-09-01'), rent('2026-10-01'),
    ];
    // 窗口 5–10 月；房租 6 月起漲價，5 月的 1 萬只比得上窗口外的 2–4 月
    rows.slice(0, 4).forEach((r) => { r.twdAmount = 10000; });
    const a = buildSpendingAnalysis({ expenses: rows, targetYm: '2026-10', todayYmd: '2026-11-02', firstYm: '2026-01' });
    expect(a.largeItems).toEqual([]);
    expect(a.months[0].daily).toBe(13000);
  });
});

describe('月初第一週不推估、不比較', () => {
  // 7–9 月每月 5 萬（一天一筆比較好算）
  const usual = () => ['2026-07', '2026-08', '2026-09'].flatMap((ym) =>
    Array.from({ length: 25 }, (_, i) => tx(`${ym}-${String(i + 1).padStart(2, '0')}`, 2000)));

  it('第 1–6 天：不給比例、分類不比、不報連續上升', () => {
    const rows = [...usual(), tx('2026-10-01', 3000)];
    const a = buildSpendingAnalysis({ expenses: rows, targetYm: '2026-10', todayYmd: '2026-10-01', firstYm: '2026-06' });
    expect(EARLY_MONTH_DAYS).toBe(7);
    expect(a.isEarly).toBe(true);
    expect(a.baseline).toBe(50000);
    expect(a.ratio).toBeNull();
    expect(a.categories[0]).toMatchObject({ ratio: null, diff: null, risingMonths: 0, current: 3000 });
  });

  it('第 7 天起照常推估與比較', () => {
    const rows = [...usual(), tx('2026-10-07', 7000)];
    const a = buildSpendingAnalysis({ expenses: rows, targetYm: '2026-10', todayYmd: '2026-10-07', firstYm: '2026-06' });
    expect(a.isEarly).toBe(false);
    expect(a.ratio).toBeCloseTo(7000 * 31 / 7 / 50000 - 1);
  });

  it('看過去的月份不受影響', () => {
    const a = buildSpendingAnalysis({ expenses: usual(), targetYm: '2026-09', todayYmd: '2026-10-02', firstYm: '2026-06' });
    expect(a.isEarly).toBe(false);
    expect(a.ratio).toBe(0);
  });

  it('這個月判斷大額時，分母至少用平常：月初一筆 1.2 萬不會因為占了到目前的九成就被抓', () => {
    const big = tx('2026-10-02', 12000, '購物', 'Costco');
    const rows = [...usual(), tx('2026-10-01', 500), big];
    const a = buildSpendingAnalysis({ expenses: rows, targetYm: '2026-10', todayYmd: '2026-10-02', firstYm: '2026-06' });
    expect(a.largeItems.map((i) => i.tx.id)).not.toContain(big.id);
    // 同一筆放在已經過完、總額只有 1.25 萬的月份就會被抓（不墊底）
    expect(detectLargeItems([tx('2026-05-01', 500), tx('2026-05-02', 12000)]).size).toBe(1);
  });
});
