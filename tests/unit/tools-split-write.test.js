import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getTodayYmd } from '../../tools/core/dates.js';

/**
 * 分帳的寫入路徑。
 *
 * 這裡守的是「網頁有做、CLI 漏做」的那一類不一致：送給 RPC 的分攤形狀、
 * 只有新增才簽到、四種通知事件的 payload，以及副作用失敗時不能反過來讓已寫入的帳看起來像失敗。
 */

const TODAY = getTodayYmd();

let calls;
let responses;

function makeClient() {
  const selectChain = (rows) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      // .eq(...).maybeSingle() 在真實 API 回的是單一列，不是陣列
      maybeSingle: async () => ({ data: Array.isArray(rows) ? rows[0] ?? null : rows, error: null }),
      then: (resolve) => resolve({ data: rows, error: null }),
    };
    return chain;
  };

  return {
    rpc: async (name, params) => {
      calls.rpc.push({ name, params });
      return responses.rpc[name] ?? { data: { id: 'expense-new' }, error: null };
    },
    from: (table) => ({
      ...selectChain(responses.rows[table] ?? []),
      upsert: async (row, options) => {
        calls.upsert.push({ table, row, options });
        return responses.upsert;
      },
      insert: (row) => ({
        select: () => ({
          single: async () => {
            calls.insert.push({ table, row });
            return { data: { id: 'settlement-1', ...row }, error: null };
          },
        }),
      }),
      delete: () => ({
        eq: async (column, value) => {
          calls.delete.push({ table, column, value });
          return { error: null };
        },
      }),
    }),
    functions: {
      invoke: (name, options) => {
        calls.invoke.push({ name, body: options?.body });
        return responses.invoke();
      },
    },
  };
}

vi.mock('../../tools/core/client.js', () => ({
  getAuthedClient: async () => makeClient(),
  getCurrentUser: async () => ({ id: 'user-doris' }),
}));

const { addExpense, updateExpense, deleteExpense, addSettlement, getExpense } = await import(
  '../../tools/core/splitExpenses.js'
);

const MEMBERS = [
  { id: 'm1', name: 'Doris', user_id: 'user-doris' },
  { id: 'm2', name: '小明', user_id: null },
];

const GROUP = { id: 'group-1', name: '日本行', currency: 'TWD', split_members: MEMBERS };

const SHARES = [
  { member_id: 'm1', share: 1500 },
  { member_id: 'm2', share: 1500 },
];

beforeEach(() => {
  calls = { rpc: [], upsert: [], insert: [], delete: [], invoke: [] };
  responses = {
    rpc: {},
    rows: {},
    upsert: { error: null },
    invoke: () => Promise.resolve({ data: null, error: null }),
  };
});

const baseExpense = {
  group: GROUP,
  title: '吃飯',
  amount: 3000,
  currency: 'TWD',
  date: TODAY,
  note: null,
  paidBy: 'm1',
  shares: SHARES,
};

describe('addExpense', () => {
  it('送給 RPC 的分攤只帶 member_id 與 share', async () => {
    await addExpense(baseExpense);

    expect(calls.rpc[0].name).toBe('add_split_expense');
    expect(calls.rpc[0].params).toMatchObject({
      p_group_id: 'group-1',
      p_title: '吃飯',
      p_amount: 3000,
      p_currency: 'TWD',
      p_date: TODAY,
      p_paid_by: 'm1',
      p_shares: SHARES,
    });
  });

  it('日期是今天就簽到，且與網頁用同一組欄位', async () => {
    const result = await addExpense(baseExpense);

    expect(calls.upsert).toEqual([
      {
        table: 'checkins',
        row: { user_id: 'user-doris', date: TODAY, source: 'onTimeTransaction' },
        options: { onConflict: 'user_id,date' },
      },
    ]);
    expect(result.checkedIn).toBe(true);
  });

  it('補記過去的日期不簽到', async () => {
    const result = await addExpense({ ...baseExpense, date: '2026-01-01' });

    expect(calls.upsert).toHaveLength(0);
    expect(result.checkedIn).toBe(false);
  });

  it('簽到失敗不會讓整筆記帳失敗', async () => {
    responses.upsert = { error: { message: 'boom' } };

    const result = await addExpense(baseExpense);

    expect(result.expense).toEqual({ id: 'expense-new' });
    expect(result.checkedIn).toBe(false);
  });

  it('通知帶齊欄位，事件是 expense_added', async () => {
    await addExpense(baseExpense);

    expect(calls.invoke[0].name).toBe('send-split-notification');
    expect(calls.invoke[0].body).toEqual({
      event: 'expense_added',
      group_id: 'group-1',
      group_name: '日本行',
      actor_name: 'Doris',
      actor_user_id: 'user-doris',
      expense_title: '吃飯',
      expense_amount: 3000,
      currency: 'TWD',
    });
  });

  it('通知失敗不會讓整筆記帳失敗', async () => {
    responses.invoke = () => Promise.reject(new Error('edge function 掛了'));

    await expect(addExpense(baseExpense)).resolves.toMatchObject({ expense: { id: 'expense-new' } });
  });

  it('登入者在群組沒有連結成員時，通知的 actor_name 是空字串（同前端）', async () => {
    const group = { ...GROUP, split_members: MEMBERS.map((m) => ({ ...m, user_id: null })) };

    await addExpense({ ...baseExpense, group });

    expect(calls.invoke[0].body.actor_name).toBe('');
  });
});

describe('RPC 例外轉成看得懂的錯誤', () => {
  it('分攤為空', async () => {
    responses.rpc.add_split_expense = { data: null, error: { message: 'SPLIT_SHARES_EMPTY' } };

    await expect(addExpense(baseExpense)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('分攤對象'),
    });
  });

  it('成員不屬於這個群組', async () => {
    responses.rpc.add_split_expense = { data: null, error: { message: 'SPLIT_SHARE_MEMBER_INVALID' } };

    await expect(addExpense(baseExpense)).rejects.toMatchObject({ code: 'MEMBER_NOT_FOUND' });
  });

  it('沒有權限', async () => {
    responses.rpc.add_split_expense = { data: null, error: { message: 'SPLIT_NO_ADD_PERMISSION' } };

    await expect(addExpense(baseExpense)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('權限'),
    });
  });

  it('原始 PostgREST 訊息不會直接外流', async () => {
    responses.rpc.add_split_expense = { data: null, error: { message: 'SPLIT_SHARES_EMPTY' } };

    await expect(addExpense(baseExpense)).rejects.not.toMatchObject({
      message: expect.stringContaining('SPLIT_SHARES_EMPTY'),
    });
  });
});

describe('updateExpense', () => {
  it('走 update_split_expense，且不簽到', async () => {
    await updateExpense({ ...baseExpense, expenseId: 'expense-1' });

    expect(calls.rpc[0].name).toBe('update_split_expense');
    expect(calls.rpc[0].params.p_expense_id).toBe('expense-1');
    expect(calls.rpc[0].params.p_shares).toEqual(SHARES);
    expect(calls.upsert).toHaveLength(0);
  });

  it('發 expense_updated 通知', async () => {
    await updateExpense({ ...baseExpense, expenseId: 'expense-1' });

    expect(calls.invoke[0].body).toMatchObject({ event: 'expense_updated', expense_title: '吃飯' });
  });
});

describe('deleteExpense', () => {
  it('只刪費用本身，分攤明細交給 ON DELETE CASCADE', async () => {
    const expense = { id: 'expense-1', title: '吃飯', amount: 3000, currency: 'TWD', date: TODAY };

    const result = await deleteExpense({ group: GROUP, expense });

    expect(calls.delete).toEqual([{ table: 'split_expenses', column: 'id', value: 'expense-1' }]);
    expect(calls.invoke[0].body).toMatchObject({ event: 'expense_deleted', expense_title: '吃飯' });
    expect(result.deleted).toBe(expense);
  });
});

describe('addSettlement', () => {
  it('寫入的是成員 id，通知帶付款與收款雙方的名字', async () => {
    await addSettlement({
      group: GROUP,
      fromMember: MEMBERS[1],
      toMember: MEMBERS[0],
      amount: 500,
      currency: 'TWD',
    });

    expect(calls.insert[0]).toMatchObject({
      table: 'split_settlements',
      row: { group_id: 'group-1', from_member: 'm2', to_member: 'm1', amount: 500, currency: 'TWD' },
    });
    expect(calls.invoke[0].body).toMatchObject({
      event: 'settlement_added',
      from_name: '小明',
      to_name: 'Doris',
      expense_amount: 500,
    });
  });
});

describe('getExpense 的 id 前綴比對', () => {
  it('唯一命中就採用', async () => {
    responses.rows.split_expenses = [
      { id: 'a3f9c21b-1111-2222-3333-444455556666', title: '吃飯', date: TODAY, group_id: 'group-1' },
      { id: 'bb111111-1111-2222-3333-444455556666', title: '計程車', date: TODAY, group_id: 'group-1' },
    ];

    const found = await getExpense('a3f9c21b');

    expect(found.id).toBe('a3f9c21b-1111-2222-3333-444455556666');
  });

  it('多筆命中要求給更完整的 id，並列出候選', async () => {
    responses.rows.split_expenses = [
      { id: 'a3f9c21b-1111-2222-3333-444455556666', title: '吃飯', date: TODAY, group_id: 'group-1' },
      { id: 'a3f9c21b-9999-2222-3333-444455556666', title: '計程車', date: TODAY, group_id: 'group-1' },
    ];

    await expect(getExpense('a3f9c21b')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      hint: expect.stringContaining('計程車'),
    });
  });

  it('零筆命中報 EXPENSE_NOT_FOUND', async () => {
    responses.rows.split_expenses = [];

    await expect(getExpense('a3f9c21b')).rejects.toMatchObject({ code: 'EXPENSE_NOT_FOUND' });
  });

  it('前綴太短要擋下', async () => {
    await expect(getExpense('a3')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('太短'),
    });
  });
});
