import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * --json 是給 AI 助理與腳本用的輸出。
 *
 * 預設的表格是給人看的：中文對齊、千分位逗號、截短成 8 碼的 id——
 * agent 從那裡解析金額或 id 很容易出錯，所以這些測試守住「加了 --json 就是乾淨 JSON」。
 */

const TX = {
  id: '11111111-2222-3333-4444-555555555555',
  date: '2026-08-30',
  time: '14:30',
  type: 'expense',
  item_name: '星巴克',
  category: '飲食',
  payment_method: '現金',
  currency: 'TWD',
  amount: 1500.5,
  exchange_rate: 1,
  twd_amount: 1500.5,
};

vi.mock('../../tools/core/transactions.js', () => ({
  addTransaction: async () => ({ transaction: TX, checkedIn: true }),
  listTransactions: async () => [TX],
  updateTransaction: async () => ({ before: TX, after: { ...TX, amount: 200 } }),
  deleteTransaction: async () => ({ deleted: TX }),
}));

vi.mock('../../tools/core/accounts.js', () => ({
  listAccounts: async () => [{ id: 'acc-1', name: '現金', type: 'cash', credit_limit: null }],
}));

vi.mock('../../tools/core/categories.js', () => ({
  listCategories: async () => ({ expense: ['飲食', '交通'], income: ['薪水'] }),
}));

vi.mock('../../tools/core/stats.js', () => ({
  getMonthlySummary: async () => ({
    year: 2026,
    month: 8,
    summary: { totalIncome: 50000, totalExpense: 12345.67, balance: 37654.33 },
    transactionCount: 3,
    expenseByCategory: [{ category: '飲食', total: 1500.5 }],
    incomeByCategory: [],
  }),
  getStreak: async () => ({ streakCount: 12, streakBroken: false, totalLoggedDays: 100, longestStreak: 30 }),
  getYearlyReview: async () => ({ success: true, year: 2026 }),
}));

const { addCommand, listCommand, editCommand, removeCommand } = await import(
  '../../tools/cli/commands/transactions.js'
);
const { accountsCommand, categoriesCommand, summaryCommand, streakCommand } = await import(
  '../../tools/cli/commands/insights.js'
);

let output;
let logSpy;

beforeEach(() => {
  output = [];
  logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => output.push(args.join(' ')));
});

afterEach(() => {
  logSpy.mockRestore();
});

/** 把整段輸出當成一份 JSON 解析；解析失敗就代表混進了給人看的文字 */
function parsed() {
  return JSON.parse(output.join('\n'));
}

describe('--json 輸出', () => {
  it('list 回傳交易陣列，金額是數字而非帶逗號的字串', async () => {
    await listCommand({ positional: [], flags: { json: true } });

    const data = parsed();
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].amount).toBe(1500.5);
    expect(typeof data[0].amount).toBe('number');
  });

  it('list 回傳完整 id，不是表格裡截短的 8 碼', async () => {
    await listCommand({ positional: [], flags: { json: true } });

    expect(parsed()[0].id).toBe(TX.id);
  });

  it('add 回傳交易本身與是否簽到', async () => {
    await addCommand({ positional: ['星巴克', '150'], flags: { json: true } });

    const data = parsed();
    expect(data.transaction.id).toBe(TX.id);
    expect(data.checkedIn).toBe(true);
  });

  it('edit 回傳修改前後', async () => {
    await editCommand({ positional: [TX.id], flags: { json: true, amount: '200' } });

    const data = parsed();
    expect(data.before.amount).toBe(1500.5);
    expect(data.after.amount).toBe(200);
  });

  it('rm 回傳被刪除的內容', async () => {
    await removeCommand({ positional: [TX.id], flags: { json: true } });

    expect(parsed().deleted.item_name).toBe('星巴克');
  });

  it('summary 回傳結構化統計', async () => {
    await summaryCommand({ flags: { json: true } });

    const data = parsed();
    expect(data.summary.totalExpense).toBe(12345.67);
    expect(data.expenseByCategory[0].category).toBe('飲食');
  });

  it('accounts 與 categories 也支援', async () => {
    await accountsCommand({ flags: { json: true } });
    expect(parsed()[0].name).toBe('現金');

    output = [];
    await categoriesCommand({ flags: { json: true } });
    expect(parsed().expense).toEqual(['飲食', '交通']);
  });

  it('streak 回傳連續天數', async () => {
    await streakCommand({ flags: { json: true } });

    expect(parsed().streakCount).toBe(12);
  });
});

describe('預設輸出（給人看的）', () => {
  it('list 印的是表格，不是 JSON', async () => {
    await listCommand({ positional: [], flags: {} });

    const text = output.join('\n');
    expect(text).toContain('─');
    expect(() => JSON.parse(text)).toThrow();
  });

  it('add 印的是人話確認訊息', async () => {
    await addCommand({ positional: ['星巴克', '150'], flags: {} });

    const text = output.join('\n');
    expect(text).toContain('已記錄');
    expect(text).toContain('今日已簽到');
  });

  it('沒有 flags 時不會壞（accounts 可不帶參數呼叫）', async () => {
    await accountsCommand();

    expect(output.join('\n')).toContain('現金');
  });
});

/**
 * `--key=value` 是 agent 最自然會寫出的形式。
 * 沒有支援時 `--split=我,小明` 會被存成 flags['split=我,小明']，於是 flags.split 是
 * undefined，呼叫端當成「沒指定」而套用預設值——不報錯，但算出來的東西是錯的。
 */
describe('parseArgs', () => {
  it('--key=value 與 --key value 解析結果相同', async () => {
    const { parseArgs } = await import('../../tools/cli/args.js');

    expect(parseArgs(['--split=我,小明']).flags).toEqual({ split: '我,小明' });
    expect(parseArgs(['--split', '我,小明']).flags).toEqual({ split: '我,小明' });
  });

  it('值裡本身含等號時只切第一個', async () => {
    const { parseArgs } = await import('../../tools/cli/args.js');

    expect(parseArgs(['--split=我=200,小明']).flags.split).toBe('我=200,小明');
  });

  it('既有的 --flag 與位置參數行為不變', async () => {
    const { parseArgs } = await import('../../tools/cli/args.js');

    const { positional, flags } = parseArgs(['星巴克', '150', '--month', '8', '--json']);
    expect(positional).toEqual(['星巴克', '150']);
    expect(flags).toEqual({ month: '8', json: true });
  });
});
