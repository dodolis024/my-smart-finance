import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * get_dashboard_data 回傳的 history 用的是 camelCase（twdAmount），不是資料表的 twd_amount。
 * 欄位名對錯了不會報錯，只會讓每個分類的金額靜默變成 0，所以這裡固定住。
 */

const mocks = vi.hoisted(() => ({ rpcImpl: vi.fn() }));

vi.mock('../../tools/core/client.js', () => ({
  getAuthedClient: async () => ({ rpc: (...args) => mocks.rpcImpl(...args) }),
  getCurrentUser: async () => ({ id: 'user-1' }),
}));

const { getMonthlySummary, getStreak } = await import('../../tools/core/stats.js');

const DASHBOARD_RESPONSE = {
  success: true,
  summary: { totalIncome: 50000, totalExpense: 12345.67, balance: 37654.33 },
  history: [
    { id: '1', category: '飲食', type: 'expense', twdAmount: 150 },
    { id: '2', category: '飲食', type: 'expense', twdAmount: 80.5 },
    { id: '3', category: '交通', type: 'expense', twdAmount: 1200 },
    { id: '4', category: '薪水', type: 'income', twdAmount: 50000 },
  ],
  streakCount: 12,
  streakBroken: false,
  totalLoggedDays: 100,
  longestStreak: 30,
};

beforeEach(() => {
  mocks.rpcImpl.mockReset();
  mocks.rpcImpl.mockResolvedValue({ data: DASHBOARD_RESPONSE, error: null });
});

describe('getMonthlySummary', () => {
  it('依分類彙總支出並由大到小排序', async () => {
    const result = await getMonthlySummary({ year: 2026, month: 8 });

    expect(result.expenseByCategory).toEqual([
      { category: '交通', total: 1200 },
      { category: '飲食', total: 230.5 },
    ]);
  });

  it('收入與支出分開彙總', async () => {
    const result = await getMonthlySummary({ year: 2026, month: 8 });

    expect(result.incomeByCategory).toEqual([{ category: '薪水', total: 50000 }]);
  });

  it('傳入 RPC 的參數與網頁儀表板一致', async () => {
    await getMonthlySummary({ year: 2026, month: 8 });

    expect(mocks.rpcImpl).toHaveBeenCalledWith('get_dashboard_data', {
      p_client_today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      p_month: 8,
      p_year: 2026,
    });
  });

  it('月份超出範圍會被擋下', async () => {
    await expect(getMonthlySummary({ year: 2026, month: 13 })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('RPC 回報失敗時拋出錯誤', async () => {
    mocks.rpcImpl.mockResolvedValue({ data: { success: false, error: 'nope' }, error: null });

    await expect(getMonthlySummary({ year: 2026, month: 8 })).rejects.toMatchObject({
      code: 'DB_ERROR',
    });
  });
});

describe('getStreak', () => {
  it('回傳連續記帳統計', async () => {
    const result = await getStreak();

    expect(result).toEqual({
      streakCount: 12,
      streakBroken: false,
      totalLoggedDays: 100,
      longestStreak: 30,
    });
  });
});
