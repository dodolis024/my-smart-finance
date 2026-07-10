import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

// React 18 的 act() 需要此旗標
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  rpcResponse: { data: null, error: null },
  rpcCalls: [],
  reset() {
    this.rpcResponse = { data: null, error: null };
    this.rpcCalls = [];
  },
}));

vi.mock('@/lib/supabase', () => {
  // fetchExpenses 的查詢鏈（select/eq/order...）最後直接被 await，故 builder 需為 thenable
  const makeBuilder = () => {
    const b = {
      select: () => b,
      eq: () => b,
      order: () => b,
      upsert: async () => ({ error: null }),
      then: (resolve) => { resolve({ data: [], error: null }); },
    };
    return b;
  };
  return {
    supabase: {
      from: () => makeBuilder(),
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
