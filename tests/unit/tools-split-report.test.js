import { describe, it, expect, vi } from 'vitest';

/**
 * 分帳報表。
 *
 * 這裡守兩件事：
 * 1. --limit 只能少印幾筆，不能少算幾筆——用截斷過的資料算結算會得到錯誤的欠款金額。
 * 2. tools/core/splitSettlement.js 與 src/lib/splitSettlement.js 是同一套演算法的兩份實作，
 *    任何一邊改了而另一邊沒跟上，同一群組的結算金額在網頁與 CLI 就會不同。
 */

const MEMBERS = [
  { id: 'm1', name: 'Doris', user_id: 'user-doris', created_at: '2026-01-01' },
  { id: 'm2', name: '小明', user_id: null, created_at: '2026-01-02' },
  { id: 'm3', name: '小美', user_id: null, created_at: '2026-01-03' },
];

const GROUP = { id: 'group-1', name: '日本行', currency: 'TWD', split_members: MEMBERS };

// 25 筆同樣的費用：Doris 每次付 300，三人各分 100
const EXPENSES = Array.from({ length: 25 }, (_, i) => ({
  id: `expense-${String(i).padStart(2, '0')}`,
  group_id: GROUP.id,
  paid_by: 'm1',
  title: `吃飯 ${i}`,
  amount: 300,
  currency: 'TWD',
  date: '2026-09-03',
  split_expense_shares: MEMBERS.map((m) => ({ id: `${i}-${m.id}`, member_id: m.id, share: 100 })),
}));

const TABLES = {
  split_expenses: EXPENSES,
  split_settlements: [],
  exchange_rates: [{ currency_code: 'JPY', rate: 0.21 }],
};

// 記下每張表被 select 了哪些欄位
globalThis.__splitReportSelects = {};

vi.mock('../../tools/core/client.js', () => {
  const query = (rows, tableName) => {
    const q = {
      select: (fields) => {
        globalThis.__splitReportSelects[tableName] = fields;
        return q;
      },
      eq: () => q,
      order: () => q,
      then: (resolve) => resolve({ data: rows, error: null }),
    };
    return q;
  };
  return {
    getAuthedClient: async () => ({ from: (tableName) => query(TABLES[tableName], tableName) }),
    getCurrentUser: async () => ({ id: 'user-doris' }),
  };
});

const { getGroupReport } = await import('../../tools/core/splitExpenses.js');

describe('getGroupReport', () => {
  it('--limit 只影響印出幾筆，結算與每人總額仍用全部費用計算', async () => {
    const report = await getGroupReport(GROUP, { limit: 20 });

    expect(report.expenses).toHaveLength(20);
    expect(report.expenseCount).toBe(25);

    // 25 筆 × 每人 100 = 2500；若誤用截斷後的 20 筆會變成 2000
    expect(report.memberTotals.m2).toBeCloseTo(2500, 6);
    expect(report.settlement).toHaveLength(2);
    report.settlement.forEach((s) => {
      expect(s.to).toBe('Doris');
      expect(s.amount).toBeCloseTo(2500, 6);
    });
  });

  it('讀取費用時帶上凍結匯率欄位，漏了結算會默默退回即時匯率', async () => {
    await getGroupReport(GROUP);
    expect(globalThis.__splitReportSelects.split_expenses).toMatch(/\bexchange_rate\b/);
    expect(globalThis.__splitReportSelects.split_expenses).toMatch(/\bexchange_rate_estimated\b/);
  });

  it('limit 有上限 200，預設 20', async () => {
    expect((await getGroupReport(GROUP)).expenses).toHaveLength(20);
    expect((await getGroupReport(GROUP, { limit: 999 })).expenses).toHaveLength(25);
  });
});

describe('與前端結算演算法的一致性', () => {
  it('同一組輸入，CLI 與網頁算出完全相同的結算與總額', async () => {
    const cli = await import('../../tools/core/splitSettlement.js');
    const web = await import('../../src/lib/splitSettlement.js');

    const rates = { TWD: 1, JPY: 0.21 };
    const expenses = [
      ...EXPENSES.slice(0, 3),
      {
        id: 'jpy-1',
        paid_by: 'm2',
        amount: 3000,
        currency: 'JPY',
        split_expense_shares: [
          { member_id: 'm1', member: 'x', share: 1000 },
          { member_id: 'm2', share: 1000 },
          { member_id: 'm3', share: 1000 },
        ],
      },
    ];
    const settlements = [{ from_member: 'm3', to_member: 'm1', amount: 200, currency: 'TWD' }];

    expect(cli.calcSettlement(MEMBERS, expenses, settlements, rates, 'TWD')).toEqual(
      web.calcSettlement(MEMBERS, expenses, settlements, rates, 'TWD')
    );
    expect(cli.calcMemberTotals(MEMBERS, expenses, rates, 'TWD')).toEqual(
      web.calcMemberTotals(MEMBERS, expenses, rates, 'TWD')
    );
  });

  it('凍結匯率：兩邊都用凍結值，而且同幣別都不換算', async () => {
    const cli = await import('../../tools/core/splitSettlement.js');
    const web = await import('../../src/lib/splitSettlement.js');

    // 即時匯率與凍結值刻意不同，任何一邊誤用即時匯率結果就會分岔
    const rates = { TWD: 1, JPY: 0.25, USD: 40 };
    const expenses = [
      { id: 'jpy-frozen', paid_by: 'm2', amount: 3000, currency: 'JPY', exchange_rate: 0.21,
        split_expense_shares: MEMBERS.map((m) => ({ member_id: m.id, share: 1000 })) },
      { id: 'jpy-legacy', paid_by: 'm1', amount: 600, currency: 'JPY', exchange_rate: null,
        split_expense_shares: MEMBERS.map((m) => ({ member_id: m.id, share: 200 })) },
      { id: 'twd', paid_by: 'm3', amount: 900, currency: 'TWD', exchange_rate: 1,
        split_expense_shares: MEMBERS.map((m) => ({ member_id: m.id, share: 300 })) },
    ];
    const settlements = [{ from_member: 'm3', to_member: 'm2', amount: 5, currency: 'USD', exchange_rate: 31.5 }];

    for (const currency of ['TWD', 'JPY']) {
      expect(cli.calcSettlement(MEMBERS, expenses, settlements, rates, currency)).toEqual(
        web.calcSettlement(MEMBERS, expenses, settlements, rates, currency)
      );
      expect(cli.calcMemberTotals(MEMBERS, expenses, rates, currency)).toEqual(
        web.calcMemberTotals(MEMBERS, expenses, rates, currency)
      );
    }
    expect(cli.conversionFactor(expenses[0], rates, 'TWD')).toBe(0.21);
    expect(cli.conversionFactor(expenses[0], rates, 'JPY')).toBe(1);
  });

  it('零小數幣別顯示 0 位小數（日圓不會印成 333.33）', async () => {
    const cli = await import('../../tools/core/splitSettlement.js');
    const web = await import('../../src/lib/splitSettlement.js');

    expect(cli.formatSplitAmount(333.33, 'JPY')).toBe('333');
    expect(cli.formatSplitAmount(333.33, 'JPY')).toBe(web.formatSplitAmount(333.33, 'JPY'));
    expect(cli.formatSplitAmount(1333.336, 'TWD')).toBe(web.formatSplitAmount(1333.336, 'TWD'));
    expect(cli.formatSplitAmount(1333.336, 'USD')).toBe(web.formatSplitAmount(1333.336, 'USD'));
  });
});
