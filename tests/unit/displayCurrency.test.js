import { describe, it, expect } from 'vitest';
import { rateOnOrBefore, convertTx, buildDisplayAmount, isRateTableUsable } from '@/lib/displayCurrency';

// 匯率語意：1 GBP = N TWD。歷史表從 2026-09-09 開始（與正式環境一致）
const table = {
  history: [
    ['2026-09-09', 42],
    ['2026-09-10', 40],
    ['2026-09-12', 44], // 09-11 故意缺（週末、排程停擺都會留洞）
  ],
  live: 50,
};
const GBP = { currency: 'GBP', amountMode: 'converted' };
const TWD = { currency: 'TWD', amountMode: 'converted' };

describe('rateOnOrBefore', () => {
  it('找當天；當天沒有就往前找最近一筆', () => {
    expect(rateOnOrBefore(table.history, '2026-09-10')).toBe(40);
    expect(rateOnOrBefore(table.history, '2026-09-11')).toBe(40);
    expect(rateOnOrBefore(table.history, '2030-01-01')).toBe(44);
  });

  it('早於歷史起點、空表、沒有日期都回 null', () => {
    expect(rateOnOrBefore(table.history, '2026-09-08')).toBeNull();
    expect(rateOnOrBefore([], '2026-09-10')).toBeNull();
    expect(rateOnOrBefore(null, '2026-09-10')).toBeNull();
    expect(rateOnOrBefore(table.history, undefined)).toBeNull();
  });

  it('大表的二分搜尋與線性搜尋結果一致', () => {
    const big = Array.from({ length: 900 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 8, 9 + i * 2));
      return [d.toISOString().slice(0, 10), 30 + (i % 17)];
    });
    for (let i = 0; i < 2000; i += 37) {
      const d = new Date(Date.UTC(2026, 8, 8 + i)).toISOString().slice(0, 10);
      const linear = big.filter(([day]) => day <= d).pop()?.[1] ?? null;
      expect(rateOnOrBefore(big, d)).toBe(linear);
    }
  });
});

describe('convertTx', () => {
  it('顯示幣別是台幣：原封不動回傳 twdAmount', () => {
    expect(convertTx({ currency: 'GBP', twdAmount: 427.55, date: '2026-09-10' }, 'TWD', table))
      .toEqual({ value: 427.55, estimated: false });
  });

  it('同幣別：用記帳時凍結的匯率反推，匯率之後怎麼變都還是原本的金額', () => {
    // £10 以 42.123 記帳，含 1.5% 手續費 → twd 427.55
    const r = convertTx({ currency: 'GBP', originalAmount: 10, exchangeRate: 42.123, twdAmount: 427.55, date: '2026-09-10' }, 'GBP', table);
    expect(r.estimated).toBe(false);
    expect(r.value).toBeCloseTo(10.15, 2);
    // 沒有手續費：剛好是輸入的 £10.00
    const plain = convertTx({ currency: 'GBP', originalAmount: 10, exchangeRate: 42.123, twdAmount: 421.23, date: '2026-09-10' }, 'GBP', table);
    expect(plain.value.toFixed(2)).toBe('10.00');
  });

  it('同幣別但缺凍結匯率：退回原幣金額', () => {
    expect(convertTx({ currency: 'gbp', amount: 8, twdAmount: 336, date: '2026-09-10' }, 'GBP', table).value).toBe(8);
  });

  it('其他幣別：用交易當天（或往前最近一筆）的歷史匯率', () => {
    expect(convertTx({ currency: 'TWD', twdAmount: 400, date: '2026-09-10' }, 'GBP', table)).toEqual({ value: 10, estimated: false });
    expect(convertTx({ currency: 'USD', twdAmount: 440, date: '2026-09-11' }, 'GBP', table)).toEqual({ value: 11, estimated: false });
  });

  it('歷史起點以前：退回今日匯率並標記估算', () => {
    expect(convertTx({ currency: 'TWD', twdAmount: 500, date: '2026-09-05' }, 'GBP', table)).toEqual({ value: 10, estimated: true });
  });
});

describe('buildDisplayAmount', () => {
  const rows = [
    { type: 'expense', currency: 'TWD', twdAmount: 400, date: '2026-09-10' }, // £10
    { type: 'expense', currency: 'TWD', twdAmount: 500, date: '2026-09-05' }, // £10（今日匯率估算）
    { type: 'income', currency: 'TWD', twdAmount: 880, date: '2026-09-12' }, // £20
  ];

  it('台幣：金額字串與加入功能前完全相同（手機版取整）', () => {
    const d = buildDisplayAmount(TWD, null);
    expect(d.currency).toBe('TWD');
    expect(d.formatTxAmount({ twdAmount: 1234.4 })).toBe('$1,234');
    expect(d.formatTxAmount({ twdAmount: 1234.6 }, { isMobile: true })).toBe('$1,235');
    expect(d.formatTotal(1939.5, { prefix: '-' })).toBe('-$1,940');
  });

  it('英鎊：單筆換算；估算的照樣顯示金額、不加任何符號', () => {
    const d = buildDisplayAmount(GBP, table);
    expect(d.formatTxAmount(rows[0])).toBe('£10.00');
    expect(d.formatTxAmount(rows[1])).toBe('£10.00');
    expect(d.toDisplay(rows[1]).estimated).toBe(true);
  });

  it('加總：估算的一樣算進去；金額字串不加符號', () => {
    const d = buildDisplayAmount(GBP, table);
    const s = d.sumTransactions(rows);
    expect(s).toEqual({ totalIncome: 20, totalExpense: 20, balance: 0 });
    expect(d.formatTotal(s.totalExpense, { prefix: '-' })).toBe('-£20.00');
  });

  it('原幣模式不受顯示幣別影響', () => {
    const d = buildDisplayAmount({ currency: 'GBP', amountMode: 'original' }, table);
    expect(d.formatTxAmount({ currency: 'USD', originalAmount: 15, twdAmount: 480, date: '2026-09-10' })).toBe('US$15.00');
  });

  it('匯率還沒載入：整個畫面暫以台幣顯示，不出現半換算的數字', () => {
    expect(isRateTableUsable(null)).toBe(false);
    expect(isRateTableUsable({ history: [], live: null })).toBe(false);
    const d = buildDisplayAmount(GBP, null);
    expect(d.currency).toBe('TWD');
    expect(d.formatTxAmount(rows[0])).toBe('$400');
    expect(d.sumTransactions(rows)).toEqual({ totalIncome: 880, totalExpense: 900, balance: -20 });
  });

  it('只有今日匯率、沒有歷史：可換算，但全部標估算', () => {
    const d = buildDisplayAmount(GBP, { history: [], live: 40 });
    expect(d.formatTxAmount(rows[0])).toBe('£10.00');
    expect(d.toDisplay(rows[0]).estimated).toBe(true);
  });
});
