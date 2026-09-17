import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

// React 18 的 act() 需要此旗標
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  rpcResponse: { data: null, error: null },
  rpcCalls: [],
  inserts: [], // { table, row }：直接 insert（不走 RPC）的寫入
  reset() {
    this.rpcResponse = { data: null, error: null };
    this.rpcCalls = [];
    this.inserts = [];
  },
}));

vi.mock('@/lib/supabase', () => {
  // fetchExpenses 的查詢鏈（select/eq/order...）最後直接被 await，故 builder 需為 thenable
  const makeBuilder = (table) => {
    const b = {
      select: () => b,
      eq: () => b,
      order: () => b,
      upsert: async () => ({ error: null }),
      // addSettlement 的 insert 直接被 await，回同一個 thenable 即可
      insert: (row) => { h.inserts.push({ table, row }); return b; },
      then: (resolve) => { resolve({ data: [], error: null }); },
    };
    return b;
  };
  return {
    supabase: {
      from: (table) => makeBuilder(table),
      rpc: async (fn, args) => {
        h.rpcCalls.push({ fn, args });
        return h.rpcResponse;
      },
    },
  };
});

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/lib/splitNotify', () => ({
  notifySplit: vi.fn(),
}));

import { useSplitExpenses } from '@/hooks/useSplitExpenses';
import { clearAllCaches } from '@/lib/resourceCache';
import { getTodayYmd } from '@/lib/utils';

const GROUP_ID = 'group-1';

function renderSplitExpenses() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const result = { current: null };
  function Harness() {
    result.current = useSplitExpenses(GROUP_ID, { actorName: 'A', actorUserId: '', groupName: 'G' });
    return null;
  }
  act(() => {
    root.render(createElement(Harness));
  });
  return {
    result,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('useSplitExpenses.addExpense', () => {
  let harness;

  beforeEach(() => {
    h.reset();
    clearAllCaches();
  });

  afterEach(() => {
    harness?.unmount();
    harness = null;
  });

  it('以正確參數呼叫 rpc(add_split_expense) 並回傳新費用', async () => {
    const newExpense = { id: 'e1', group_id: GROUP_ID, title: '晚餐', amount: 300 };
    h.rpcResponse = { data: newExpense, error: null };
    harness = renderSplitExpenses();

    let result;
    await act(async () => {
      result = await harness.result.current.addExpense({
        title: '晚餐',
        amount: 300,
        currency: 'TWD',
        date: '2026-01-01',
        note: '',
        paidBy: 'm1',
        shares: [
          { member_id: 'm1', share: 150 },
          { member_id: 'm2', share: 150 },
        ],
      });
    });

    expect(h.rpcCalls).toEqual([
      {
        fn: 'add_split_expense',
        args: {
          p_group_id: GROUP_ID,
          p_title: '晚餐',
          p_amount: 300,
          p_currency: 'TWD',
          p_date: '2026-01-01',
          p_note: null,
          p_paid_by: 'm1',
          p_shares: [
            { member_id: 'm1', share: 150 },
            { member_id: 'm2', share: 150 },
          ],
        },
      },
    ]);
    expect(result).toEqual(newExpense);
  });

  it('rpc 失敗時拋出錯誤', async () => {
    h.rpcResponse = { data: null, error: new Error('分攤成員不屬於此群組') };
    harness = renderSplitExpenses();

    let caught = null;
    await act(async () => {
      try {
        await harness.result.current.addExpense({
          title: '晚餐', amount: 300, currency: 'TWD', date: '2026-01-01',
          note: '', paidBy: 'mx', shares: [{ member_id: 'mx', share: 300 }],
        });
      } catch (e) {
        caught = e;
      }
    });
    expect(caught?.message).toBe('分攤成員不屬於此群組');
  });
});

describe('useSplitExpenses.addSettlement', () => {
  let harness;

  beforeEach(() => {
    h.reset();
    clearAllCaches();
  });

  afterEach(() => {
    harness?.unmount();
    harness = null;
  });

  it('還款帶裝置本地日期，不交給資料庫預設（UTC 時鐘會讓凌晨的還款變成前一天）', async () => {
    harness = renderSplitExpenses();

    await act(async () => {
      await harness.result.current.addSettlement({
        fromMember: 'm2', toMember: 'm1', amount: 500, currency: 'TWD',
      });
    });

    expect(h.inserts).toEqual([
      {
        table: 'split_settlements',
        row: { date: getTodayYmd(), group_id: GROUP_ID, from_member: 'm2', to_member: 'm1', amount: 500, currency: 'TWD' },
      },
    ]);
  });
});
