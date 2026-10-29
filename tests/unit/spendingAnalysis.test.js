import { describe, it, expect } from 'vitest';
import {
  addMonths,
  monthGap,
  daysInMonth,
  chartMonths,
  monthAxisLabels,
  detectLargeItems,
  baselineMonths,
  monthsBetween,
  analysisStartOf,
  baselineStartOf,
  normalizeStartYm,
  normalizeChartSpan,
  risingStreak,
  buildSpendingAnalysis,
  largeMeasure,
  normalizeLargeThreshold,
  roundForCurrency,
  thresholdFromInput,
  thresholdForDisplay,
  roundSignificant,
  DEFAULT_LARGE_THRESHOLD,
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

  it('chartMonths：前面幾個月（預設 6）加上目標月份，舊到新', () => {
    expect(chartMonths('2026-02')).toEqual(['2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']);
    expect(chartMonths('2026-02', 3)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(chartMonths('2026-02', 12)).toHaveLength(13);
  });

  it('monthsBetween 含頭尾、跨年；起點比終點晚就是空的', () => {
    expect(monthsBetween('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(monthsBetween('2026-02', '2026-02')).toEqual(['2026-02']);
    expect(monthsBetween('2026-03', '2026-02')).toEqual([]);
  });

  it('risingStreak 只算尾端連續上升', () => {
    expect(risingStreak([5, 1, 2, 3])).toBe(2);
    expect(risingStreak([3, 2, 1])).toBe(0);
    expect(risingStreak([1])).toBe(0);
  });
});

describe('detectLargeItems', () => {
  it('預設門檻 NT$10,000：剛好一萬就算，差一塊不算', () => {
    const exact = tx('2026-10-14', 10000, '購物');
    const below = tx('2026-10-15', 9999, '購物');
    expect(detectLargeItems([exact, below])).toEqual(new Set([exact.id]));
  });

  it('只看金額，跟當月花多少無關：同一筆不會隨著月中累積一下是大額、一下又不是', () => {
    const phone = tx('2026-10-02', 32900, '購物', 'iPhone');
    const fewDays = [phone, tx('2026-10-01', 500)];
    const fullMonth = [phone, ...Array.from({ length: 30 }, (_, i) => tx(`2026-10-${String(i + 1).padStart(2, '0')}`, 5000))];
    expect(detectLargeItems(fewDays).has(phone.id)).toBe(true);
    expect(detectLargeItems(fullMonth).has(phone.id)).toBe(true);
  });

  it('單筆小額不算（小月份的一筆咖啡不會被抓）；退款的負數也不算', () => {
    expect(detectLargeItems([tx('2026-08-02', 150), tx('2026-08-08', -25000)]).size).toBe(0);
  });

  it('沒有例外：每個月固定付的房租超過門檻也會被標', () => {
    const rent = tx('2026-10-05', 12000, '居住', '房租');
    const phone = tx('2026-10-18', 32900, '購物', 'iPhone');
    expect(detectLargeItems([rent, phone])).toEqual(new Set([rent.id, phone.id]));
  });

  it('使用者自己設的門檻', () => {
    const rows = [tx('2026-10-02', 3000), tx('2026-10-03', 6000)];
    const measure = largeMeasure({ amount: 5000, currency: 'TWD', twd: 5000 });
    expect(detectLargeItems(rows, measure)).toEqual(new Set([rows[1].id]));
  });
});

describe('大額門檻與匯率', () => {
  // 英鎊匯率表：1 GBP = 40 TWD（9/1 起）、42 TWD（10/1 起）；今日 41
  const gbpTable = { history: [['2026-09-01', 40], ['2026-10-01', 42]], live: 41 };
  const gbpThreshold = { amount: 250, currency: 'GBP', twd: 250 * 41 };

  it('外幣門檻：英鎊記的帳用記帳當下的匯率反推回原幣，畫面上 £250.00 的那筆一定被標', () => {
    // £250 記帳時匯率 41.37，台幣存成 10342.5；換回英鎊會有浮點尾數，四捨五入到分之後剛好 £250
    const exact = { ...tx('2026-10-05', 10342.5, '購物'), currency: 'GBP', exchangeRate: 41.37 };
    const below = { ...tx('2026-10-06', 249.99 * 41.37, '購物'), currency: 'GBP', exchangeRate: 41.37 };
    const measure = largeMeasure(gbpThreshold, gbpTable);
    expect(measure.valueOf(exact)).toBe(250);
    expect(detectLargeItems([exact, below], measure)).toEqual(new Set([exact.id]));
  });

  it('外幣門檻：台幣記的帳用交易當天的歷史匯率換算，跟顯示幣別換算的結果一樣', () => {
    const sept = tx('2026-09-15', 10000, '購物'); // 9 月匯率 40 → £250
    const oct = tx('2026-10-15', 10000, '購物'); // 10 月匯率 42 → £238.10
    const measure = largeMeasure(gbpThreshold, gbpTable);
    expect(measure.valueOf(sept)).toBe(250);
    expect(measure.valueOf(oct)).toBe(238.1);
    expect(detectLargeItems([sept, oct], measure)).toEqual(new Set([sept.id]));
  });

  it('門檻幣別的匯率表讀不到：退回用台幣比存設定時換好的金額，不會整批標錯或全部不標', () => {
    const measure = largeMeasure(gbpThreshold, null);
    expect(measure.min).toBe(10250);
    expect(detectLargeItems([tx('2026-10-15', 10250), tx('2026-10-16', 10249)], measure).size).toBe(1);
  });

  it('台幣門檻：小數四捨五入到個位再比（畫面上顯示 $10,000 的那筆會被標）', () => {
    const measure = largeMeasure(DEFAULT_LARGE_THRESHOLD);
    expect(detectLargeItems([tx('2026-10-15', 9999.6)], measure).size).toBe(1);
    expect(detectLargeItems([tx('2026-10-15', 9999.4)], measure).size).toBe(0);
  });

  it('換顯示幣別不影響哪幾筆被標：比的是門檻的幣別，不是顯示幣別', () => {
    const rows = [tx('2026-10-15', 12000), tx('2026-10-16', 8000)];
    const asTwd = buildSpendingAnalysis({ expenses: rows, targetYm: '2026-10', todayYmd: '2026-10-31', firstYm: '2026-01' });
    const asGbp = buildSpendingAnalysis({
      expenses: rows, targetYm: '2026-10', todayYmd: '2026-10-31', firstYm: '2026-01', toValue: (t) => t.twdAmount / 42,
    });
    expect(asGbp.largeItems.map((i) => i.tx.id)).toEqual(asTwd.largeItems.map((i) => i.tx.id));
    // 列出來的金額跟著顯示幣別
    expect(asGbp.largeItems[0].value).toBeCloseTo(12000 / 42, 6);
  });

  it('roundForCurrency：台幣、日圓到個位，其他到分', () => {
    expect(roundForCurrency(9999.6, 'TWD')).toBe(10000);
    expect(roundForCurrency(1234.5, 'JPY')).toBe(1235);
    expect(roundForCurrency(249.996, 'GBP')).toBe(250);
    expect(roundForCurrency(249.994, 'gbp')).toBe(249.99);
  });

  it('輸入門檻：外幣用今日匯率換一份台幣；沒有今日匯率用歷史最後一筆；都沒有回 null', () => {
    expect(thresholdFromInput(10000, 'TWD', null)).toEqual({ amount: 10000, currency: 'TWD', twd: 10000 });
    expect(thresholdFromInput(250.004, 'GBP', gbpTable)).toEqual({ amount: 250, currency: 'GBP', twd: 250 * 41 });
    expect(thresholdFromInput(250, 'GBP', { history: [['2026-10-01', 42]], live: null })).toEqual({ amount: 250, currency: 'GBP', twd: 250 * 42 });
    expect(thresholdFromInput(250, 'GBP', null)).toBeNull();
  });

  it('roundSignificant：只留兩位有效數字', () => {
    expect(roundSignificant(235.8)).toBe(240);
    expect(roundSignificant(48316)).toBe(48000);
    expect(roundSignificant(10592)).toBe(11000);
    expect(roundSignificant(312.5)).toBe(310);
    expect(roundSignificant(9.46)).toBe(9.5);
  });

  it('門檻在其他幣別下：用今天的匯率換算、取兩位有效數字、標成約；同幣別就是原本的金額', () => {
    // 台幣 10,000 → 英鎊（今日 41）≈ 243.9 → 約 £240
    expect(thresholdForDisplay(DEFAULT_LARGE_THRESHOLD, 'GBP', null, gbpTable)).toEqual({ amount: 240, currency: 'GBP', approx: true });
    expect(thresholdForDisplay(DEFAULT_LARGE_THRESHOLD, 'TWD', null, null)).toEqual({ amount: 10000, currency: 'TWD', approx: false });
    // 英鎊 250：同幣別照原本的金額，不取整數
    const odd = { amount: 250.5, currency: 'GBP', twd: 250.5 * 41 };
    expect(thresholdForDisplay(odd, 'GBP', gbpTable, gbpTable)).toEqual({ amount: 250.5, currency: 'GBP', approx: false });
    // 英鎊 250 → 台幣：用英鎊今天的匯率（41），不是存設定時的備用值 → 10,250 → 約 $10,000
    const stale = { amount: 250, currency: 'GBP', twd: 250 * 35 };
    expect(thresholdForDisplay(stale, 'TWD', gbpTable, null)).toEqual({ amount: 10000, currency: 'TWD', approx: true });
    // 英鎊匯率讀不到：退回備用值 8,750 → 約 $8,800
    expect(thresholdForDisplay(stale, 'TWD', null, null)).toEqual({ amount: 8800, currency: 'TWD', approx: true });
    // 顯示幣別的匯率讀不到：回 null（畫面照門檻本身的幣別寫）
    expect(thresholdForDisplay(DEFAULT_LARGE_THRESHOLD, 'GBP', null, null)).toBeNull();
  });

  it('換算顯示只是參考：判斷哪幾筆是大額，一律照門檻本身的幣別', () => {
    // 門檻 NT$10,000；英鎊畫面寫「約 £240」，但 NT$10,100（約 £240.48，以 42 換算）照樣是大額、NT$9,900 照樣不是
    const near = [tx('2026-10-15', 10100), tx('2026-10-16', 9900)];
    const a = buildSpendingAnalysis({
      expenses: near, targetYm: '2026-10', todayYmd: '2026-10-31', firstYm: '2026-01', toValue: (t) => t.twdAmount / 42,
    });
    expect(a.largeItems.map((i) => i.tx.id)).toEqual([near[0].id]);
  });

  it('設定讀回來格式不對就用預設值', () => {
    expect(normalizeLargeThreshold(null)).toBe(DEFAULT_LARGE_THRESHOLD);
    expect(normalizeLargeThreshold({ amount: -5, currency: 'TWD', twd: 5 })).toBe(DEFAULT_LARGE_THRESHOLD);
    expect(normalizeLargeThreshold({ amount: 250, currency: 'gbp', twd: 10250 })).toEqual({ amount: 250, currency: 'GBP', twd: 10250 });
  });
});

describe('baselineMonths', () => {
  it('前 N 個月（預設半年）；沒設起點時不早於帳本第二個月', () => {
    expect(baselineMonths('2026-10', '2026-07')).toEqual(['2026-09', '2026-08']);
    expect(baselineMonths('2026-10', '2026-01')).toEqual(['2026-09', '2026-08', '2026-07', '2026-06', '2026-05', '2026-04']);
    expect(baselineMonths('2026-10', '2026-01', null, 3)).toEqual(['2026-09', '2026-08', '2026-07']);
    expect(baselineMonths('2026-10', '2026-01', null, 12)).toEqual(
      ['2026-09', '2026-08', '2026-07', '2026-06', '2026-05', '2026-04', '2026-03', '2026-02'],
    );
  });

  it('設了起點：從起點那個月算起（含帳本第一個月，使用者自己選的）', () => {
    expect(baselineMonths('2026-10', '2026-01', '2026-06')).toEqual(['2026-09', '2026-08', '2026-07', '2026-06']);
    expect(baselineMonths('2026-03', '2026-01', '2026-01')).toEqual(['2026-02', '2026-01']);
    // 起點比開始記帳還早：從開始記帳那個月算
    expect(baselineMonths('2026-03', '2026-01', '2025-06')).toEqual(['2026-02', '2026-01']);
  });

  it('還沒有完整月份就是空的', () => {
    expect(baselineMonths('2026-10', '2026-10')).toEqual([]);
    expect(baselineMonths('2026-10', '2026-09')).toEqual([]);
    expect(baselineMonths('2026-10', null)).toEqual([]);
    expect(baselineMonths('2026-10', '2026-01', '2026-10')).toEqual([]);
  });
});

describe('分析起點與長條圖月數', () => {
  it('起點：沒設定就是帳本第一個月；設得比開始記帳早就從開始記帳算', () => {
    expect(analysisStartOf('2026-01', null)).toBe('2026-01');
    expect(analysisStartOf('2026-01', '2026-05')).toBe('2026-05');
    expect(analysisStartOf('2026-01', '2025-05')).toBe('2026-01');
    expect(analysisStartOf(null, '2026-05')).toBeNull();
    expect(baselineStartOf('2026-01', null)).toBe('2026-02');
    expect(baselineStartOf('2026-01', '2026-01')).toBe('2026-01');
  });

  it('讀設定：格式不對就當成沒設定／預設半年', () => {
    expect(normalizeStartYm({ month: '2026-03' })).toBe('2026-03');
    expect(normalizeStartYm({ month: null })).toBeNull();
    expect(normalizeStartYm({ month: '2026-13' })).toBeNull();
    expect(normalizeStartYm(undefined)).toBeNull();
    expect(normalizeChartSpan({ months: 12 })).toBe(12);
    expect(normalizeChartSpan({ months: 5 })).toBe(6);
    expect(normalizeChartSpan(null)).toBe(6);
  });

  // 1–3 月每月 3 萬（搬家前），4 月起每月 1 萬；午餐每月越吃越多
  function moved() {
    const rows = [];
    for (const m of ['01', '02', '03']) rows.push(tx(`2026-${m}-10`, 30000, '居住', '舊家'));
    for (const m of ['04', '05', '06', '07', '08', '09', '10']) rows.push(tx(`2026-${m}-10`, 10000, '居住', '新家'));
    ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'].forEach((m, i) => rows.push(tx(`2026-${m}-12`, 1000 + i * 100, '飲食', '午餐')));
    return rows;
  }
  const build = (extra) => buildSpendingAnalysis({
    expenses: moved(), targetYm: '2026-10', todayYmd: '2026-11-02', firstYm: '2026-01', ...extra,
  });

  it('平常是前 N 個月的平均：一年碰到帳本第二個月就停，起點設 8 月就只算 8 月以後', () => {
    const year = build({ chartSpan: 12 });
    expect(year.baselineMonths).toHaveLength(8);
    expect(year.baselineMonths.at(-1)).toBe('2026-02');
    // 居住 2、3 月 3 萬、4–9 月 1 萬；午餐 2–9 月 1,100…1,800 的平均 1,450
    expect(year.baseline).toBeCloseTo((30000 * 2 + 10000 * 6) / 8 + 1450, 6);
    // 半年 4–9 月：居住 1 萬、午餐 1,300…1,800 的平均 1,550
    expect(build().baseline).toBeCloseTo(10000 + 1550, 6);
    // 一季 7–9 月：午餐 1,600…1,800 的平均 1,700
    expect(build({ chartSpan: 3 }).baseline).toBeCloseTo(10000 + 1700, 6);
    const fromAug = build({ startYm: '2026-08', chartSpan: 12 });
    expect(fromAug.baselineMonths).toEqual(['2026-09', '2026-08']);
  });

  it('長條圖只畫拿來算平常的月份加上正在看的月份：起點以前的不畫', () => {
    const a = build({ startYm: '2026-07' });
    expect(a.months.map((m) => m.ym)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10']);
    expect(a.categories.find((c) => c.name === '飲食').series).toEqual([1600, 1700, 1800, 1900]);
    expect(a.analysisStartYm).toBe('2026-07');
  });

  it('看起點以前的月份：不分析', () => {
    const a = build({ startYm: '2026-07', targetYm: '2026-05' });
    expect(a.isBeforeStart).toBe(true);
    expect(a.isBeforeRecords).toBe(false);
    const b = build({ targetYm: '2025-12' });
    expect(b.isBeforeStart).toBe(true);
    expect(b.isBeforeRecords).toBe(true);
  });

  it('選幾個月：平常、分類的平常、長條數一起換；連續上升照樣數到起點', () => {
    const results = [3, 6, 12].map((chartSpan) => build({ chartSpan }));
    // 一年往前推到 2025 年 10 月，但帳本第一個月 1 月不算，從 2 月畫起
    expect(results.map((a) => a.months.length)).toEqual([4, 7, 9]);
    const lunch = results.map((a) => a.categories.find((c) => c.name === '飲食'));
    expect(lunch.map((c) => c.series.length)).toEqual([4, 7, 9]);
    expect(lunch.map((c) => c.usual)).toEqual([1700, 1550, 1450]);
    // 午餐 2 月起每個月都比前一個月多（帳本第一個月 1 月不算）：連續 8 個月上升，選一季也照樣是 8
    expect(lunch.map((c) => c.risingMonths)).toEqual([8, 8, 8]);
    expect(new Set(results.map((a) => a.baseline)).size).toBe(3);
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

  it('大額照算、帳本第一個月不算進平常、月中跟平常同期比', () => {
    const { all, tuition, rent } = realisticLedger();
    const a = buildSpendingAnalysis({ expenses: all, targetYm: '2026-10', todayYmd: '2026-10-27', firstYm: '2026-07' });
    const everyday = 21 * 2005.33;

    expect(a.isCurrent).toBe(true);
    expect(a.baselineMonths).toEqual(['2026-09', '2026-08']);
    expect(a.baseline).toBeCloseTo((16013 + 9049 + 21 * 3032) / 2, 0);
    // 學費、房租照樣算進本月
    expect(a.toDate).toBeCloseTo(everyday + 467725 + 77511, 1);
    // 8、9 月的支出都在 1–27 號：平常同期就是整個月，之後也沒有平常會花的 → 月底預估就是已經花的
    expect(a.baselineToDate).toBeCloseTo(a.baseline, 6);
    expect(a.projected).toBeCloseTo(a.toDate, 6);
    expect(a.ratio).toBeCloseTo(a.toDate / a.baselineToDate - 1, 6);
    // 只標示：本月的大額單筆列出來、加總給卡片用
    expect(a.largeItems.map((l) => l.tx.id)).toEqual([rent.id, tuition.id]);
    expect(a.largeTotal).toBeCloseTo(467725 + 77511, 0);
    expect(a.months.at(-1).daily).toBeCloseTo(a.toDate, 6);
    expect(a.categories.find((c) => c.name === '上學').current).toBe(467725);
  });

  it('大額單筆只列正在看的這個月', () => {
    const { all } = realisticLedger();
    const a = buildSpendingAnalysis({ expenses: all, targetYm: '2026-09', todayYmd: '2026-10-27', firstYm: '2026-07' });
    expect(a.largeItems).toEqual([]);
    expect(a.largeTotal).toBe(0);
  });

  it('過去月份的大額單筆算進平常', () => {
    const { all } = realisticLedger();
    const a = buildSpendingAnalysis({ expenses: all, targetYm: '2026-11', todayYmd: '2026-11-30', firstYm: '2026-07' });
    expect(a.baselineMonths).toEqual(['2026-10', '2026-09', '2026-08']);
    expect(a.baseline).toBeCloseTo((16013 + (9049 + 21 * 3032) + (467725 + 77511 + 21 * 2005.33)) / 3, 0);
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

  it('開始記帳之前的月份標記 isBeforeStart，不是「還不能比」', () => {
    const before = buildSpendingAnalysis({ expenses: [], targetYm: '2025-06', todayYmd: '2026-10-10', firstYm: '2026-01' });
    expect(before.isBeforeStart).toBe(true);
    const first = buildSpendingAnalysis({ expenses: [], targetYm: '2026-01', todayYmd: '2026-10-10', firstYm: '2026-01' });
    expect(first.isBeforeStart).toBe(false);
  });

  it('分類依多花的金額排序，並算出連續上升的月數', () => {
    const rows = [
      // 飲食：7、8、9 月 1000 → 10 月到 15 號 1500（多 500）
      tx('2026-07-05', 1000, '飲食'), tx('2026-08-05', 1000, '飲食'), tx('2026-09-05', 1000, '飲食'),
      tx('2026-10-05', 1500, '飲食'),
      // 交通：每月 3000 → 10 月到 15 號 500（少 2500）
      tx('2026-07-06', 3000, '交通'), tx('2026-08-06', 3000, '交通'), tx('2026-09-06', 3000, '交通'),
      tx('2026-10-06', 500, '交通'),
      // 娛樂：7 月 0 → 8 → 9 → 10 月一路上升（帳本 6 月就開始，7 月的 0 是真的沒花）
      tx('2026-08-07', 100, '娛樂'), tx('2026-09-07', 200, '娛樂'), tx('2026-10-07', 400, '娛樂'),
    ];
    // 今天 10/15：平常的支出都在 1–15 號，平常同期就是整個月
    const a = buildSpendingAnalysis({ expenses: rows, targetYm: '2026-10', todayYmd: '2026-10-15', firstYm: '2026-06' });
    expect(a.categories.map((c) => c.name)).toEqual(['飲食', '娛樂', '交通']);
    const food = a.categories[0];
    expect(food.baseline).toBe(1000);
    expect(food.diff).toBe(500);
    expect(a.categories[1].risingMonths).toBe(3);
    expect(food.txs).toHaveLength(1);
  });

  it('跟平常同期比：已經花的不放大，平常月底才花的不算進同期，只補進月底預估', () => {
    // 7–9 月：10 號吃飯 1000、25 號買東西 2000（每次店名不同，不是固定支出）
    const rows = ['07', '08', '09'].flatMap((m) => [
      tx(`2026-${m}-10`, 1000, '飲食'), tx(`2026-${m}-25`, 2000, '購物', `購物${m}`),
    ]);
    const shoes = tx('2026-10-12', 3000, '購物', '球鞋');
    rows.push(tx('2026-10-10', 1000, '飲食'), shoes);
    const a = buildSpendingAnalysis({ expenses: rows, targetYm: '2026-10', todayYmd: '2026-10-15', firstYm: '2026-06' });
    expect(a.baseline).toBe(3000);
    expect(a.baselineToDate).toBe(1000);
    expect(a.toDate).toBe(4000);
    expect(a.ratio).toBeCloseTo(3);
    expect(a.projected).toBe(6000);
    const shop = a.categories.find((c) => c.name === '購物');
    // 顯示的金額就是實際花的，跟點進去的明細加起來一樣
    expect(shop.current).toBe(3000);
    expect(shop.txs).toEqual([shoes]);
    expect(shop.usual).toBe(2000);
    expect(shop.baseline).toBe(0);
    expect(shop.diff).toBe(3000);
    expect(shop.ratio).toBeNull();
    expect(shop.projected).toBe(5000);
    expect(a.categories[0].name).toBe('購物');
  });

  it('金額走顯示幣別換算，大額判斷看門檻的幣別（預設台幣）', () => {
    const big = tx('2026-10-02', 40000, '上學');
    const small = tx('2026-10-03', 4000, '飲食');
    const b = buildSpendingAnalysis({
      expenses: [big, small], targetYm: '2026-10', todayYmd: '2026-10-31', firstYm: '2026-01',
      toValue: (t) => t.twdAmount / 40,
    });
    expect(b.largeItems.map((l) => l.tx.id)).toEqual([big.id]);
    expect(b.toDate).toBeCloseTo(1100, 6);
    expect(b.largeItems[0].value).toBeCloseTo(1000, 6);
    expect(b.largeTotal).toBeCloseTo(1000, 6);
  });

  it('空白分類歸到未分類', () => {
    const a = buildSpendingAnalysis({
      expenses: [{ ...tx('2026-10-03', 300), category: '  ' }], targetYm: '2026-10', todayYmd: '2026-10-31', firstYm: '2026-01',
      uncategorizedLabel: '未分類',
    });
    expect(a.categories[0].name).toBe('未分類');
  });
});

describe('一般用戶的帳：房租、訂閱、每天的午餐', () => {
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

  it('房租超過門檻也照樣標成大額（新 → 舊），金額都算進本月', () => {
    const rows = ledger(27);
    const phone = tx('2026-10-18', 32900, '購物', 'iPhone 17');
    const a = buildSpendingAnalysis({ expenses: [...rows, phone], targetYm: '2026-10', todayYmd: '2026-10-27', firstYm: '2026-03' });
    const rent = rows.find((r) => r.itemName === '房租' && r.date === '2026-10-05');
    expect(a.largeItems.map((l) => l.tx.id)).toEqual([phone.id, rent.id]);
    expect(a.toDate).toBe(12000 + 390 + 27 * 700 + 32900);
  });

  it('月底預估 = 已經花的 + 平常 28 號之後的午餐；房租與訂閱已經付了，不會多算', () => {
    const a = buildSpendingAnalysis({ expenses: ledger(27), targetYm: '2026-10', todayYmd: '2026-10-27', firstYm: '2026-03' });
    // 平常是 5–9 月（3、4 月沒記帳不算）：28 號之後 5、7、8 月各 4 天，6、9 月各 3 天
    expect(a.projected).toBeCloseTo(12000 + 390 + 27 * 700 + (700 * 18) / 5, 6);
    expect(a.ratio).toBeCloseTo(0, 6);
    const subs = a.categories.find((c) => c.name === '訂閱');
    expect(subs.ratio).toBeCloseTo(0, 6);
  });

  it('月初房租還沒付：平常 5 號的房租會算進月底預估', () => {
    const a = buildSpendingAnalysis({ expenses: ledger(3), targetYm: '2026-10', todayYmd: '2026-10-03', firstYm: '2026-03' });
    // 5–9 月 4 號之後的午餐：28 + 27 + 28 + 28 + 27 天
    expect(a.projected).toBeCloseTo(390 + 3 * 700 + 12000 + (700 * 138) / 5, 6);
    const housing = a.categories.find((c) => c.name === '居住');
    expect(housing.current).toBe(0);
    expect(housing.projected).toBe(12000);
    // 月初還不比
    expect(a.ratio).toBeNull();
  });

  it('付款日已經過了還沒出現，不自動補（可能退租或改了日子）', () => {
    const a = buildSpendingAnalysis({ expenses: ledger(3), targetYm: '2026-10', todayYmd: '2026-10-08', firstYm: '2026-03' });
    expect(a.categories.find((c) => c.name === '居住').projected).toBe(0);
  });

  it('看過去的月份：月底預估就是整個月的金額', () => {
    const rows = ledger(31).filter((r) => !(r.itemName === '房租' && r.date === '2026-09-05'));
    const a = buildSpendingAnalysis({ expenses: rows, targetYm: '2026-09', todayYmd: '2026-10-27', firstYm: '2026-03' });
    expect(a.projected).toBe(a.toDate);
    expect(a.baselineToDate).toBe(a.baseline);
  });
});

describe('審查後修正的邊界情況', () => {
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

  it('平常是 0（那幾個月加起來只有退款）就不比較', () => {
    const rows = [tx('2026-09-10', -500, '購物', '退貨'), tx('2026-10-10', 9000)];
    const a = buildSpendingAnalysis({ expenses: rows, targetYm: '2026-10', todayYmd: '2026-11-02', firstYm: '2026-08' });
    expect(a.baseline).toBeNull();
    expect(a.ratio).toBeNull();
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

  it('第 7 天起照常跟平常同期比', () => {
    const rows = [...usual(), tx('2026-10-07', 7000)];
    const a = buildSpendingAnalysis({ expenses: rows, targetYm: '2026-10', todayYmd: '2026-10-07', firstYm: '2026-06' });
    expect(a.isEarly).toBe(false);
    // 平常 1–7 號：7 天 × 2,000
    expect(a.baselineToDate).toBe(14000);
    expect(a.ratio).toBeCloseTo(-0.5);
  });

  it('看過去的月份不受影響', () => {
    const a = buildSpendingAnalysis({ expenses: usual(), targetYm: '2026-09', todayYmd: '2026-10-02', firstYm: '2026-06' });
    expect(a.isEarly).toBe(false);
    expect(a.ratio).toBe(0);
  });
});

describe('monthAxisLabels', () => {
  const labelOf = (ym) => `${Number(ym.slice(5, 7))}月`;
  it('跨年：第一個月和 1 月下面多一行年份', () => {
    expect(monthAxisLabels(['2025-11', '2025-12', '2026-01', '2026-02'], labelOf))
      .toEqual([['11月', '2025'], '12月', ['1月', '2026'], '2月']);
  });
  it('同一年內只寫月份', () => {
    expect(monthAxisLabels(['2026-01', '2026-02', '2026-03'], labelOf)).toEqual(['1月', '2月', '3月']);
    expect(monthAxisLabels([], labelOf)).toEqual([]);
  });
});
