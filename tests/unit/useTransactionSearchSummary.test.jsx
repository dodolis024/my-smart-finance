import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

// React 18 的 act() 需要此旗標
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// 依序回應每次查詢：queue 依 FIFO shift；calls 記錄每次終端 await 的 limit，
// 用來驗「超過上限時是否另發第二次查詢、且第二次限額為總命中數」。
const h = vi.hoisted(() => ({
  queue: [],
  calls: [],
  reset() {
    this.queue = [];
    this.calls = [];
  },
}));

vi.mock('@/lib/supabase', () => {
  const makeBuilder = () => {
    const state = { limit: null };
    const b = {
      select: () => b,
      eq: () => b,
      or: () => b,
      order: () => b,
      limit: (n) => {
        state.limit = n;
        return b;
      },
      // builder 直接被 await：記錄本次 limit，回傳 queue 中的下一筆回應
      then: (resolve, reject) => {
        h.calls.push({ limit: state.limit });
        const resp = h.queue.shift() || { data: [], count: null, error: null };
        return Promise.resolve(resp).then(resolve, reject);
      },
    };
    return b;
  };
  return { supabase: { from: () => makeBuilder() } };
});

import {
  useTransactionSearch,
  sumTransactions,
} from '@/hooks/useTransactionSearch';

// 蛇形交易列（fetchTransactionMatches 會經 mapSearchRow 轉駝峰後才加總）
function row(type, twd, id = Math.random().toString(36).slice(2)) {
  return {
    id,
    date: '2026-05-01',
    type,
    item_name: '項目',
    category: '英國',
    payment_method: '信用卡',
    currency: 'TWD',
    amount: twd,
    exchange_rate: 1,
    twd_amount: twd,
    note: '',
  };
}

function renderSearch(initialProps) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const result = { current: null };
  function Harness({ userId, query }) {
    result.current = useTransactionSearch(userId, query);
    return null;
  }
  const render = (props) => {
    act(() => {
      root.render(createElement(Harness, props));
    });
  };
  render(initialProps);
  return {
    result,
    rerender: render,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

// 推進 debounce 並讓串接的兩次查詢 microtask 全部落地
async function settle(ms = 300) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe('sumTransactions', () => {
  it('分別加總收入/支出，結餘 = 收入 − 支出', () => {
    const s = sumTransactions([
      { type: 'income', twdAmount: 1000 },
      { type: 'expense', twdAmount: 300 },
      { type: 'expense', twdAmount: 200 },
    ]);
    expect(s).toEqual({ totalIncome: 1000, totalExpense: 500, balance: 500 });
  });

  it('非數字 twdAmount 一律當 0，不污染總額', () => {
    const s = sumTransactions([
      { type: 'expense', twdAmount: '300' }, // 字串
      { type: 'expense', twdAmount: null },
      { type: 'expense' }, // undefined
      { type: 'income', twdAmount: NaN }, // NaN 是 number，但相加後為 NaN → 見下方單獨驗
    ]);
    // 上面 income 的 NaN 會讓 income/balance 變 NaN，因此另用純數字案例驗「非 number 當 0」
    expect(Number.isNaN(s.totalIncome)).toBe(true);

    const s2 = sumTransactions([
      { type: 'expense', twdAmount: '300' },
      { type: 'expense', twdAmount: null },
      { type: 'expense' },
      { type: 'expense', twdAmount: 120 },
    ]);
    expect(s2).toEqual({ totalIncome: 0, totalExpense: 120, balance: -120 });
  });

  it('空陣列或 null 回傳全 0', () => {
    const zero = { totalIncome: 0, totalExpense: 0, balance: 0 };
    expect(sumTransactions([])).toEqual(zero);
    expect(sumTransactions(null)).toEqual(zero);
    expect(sumTransactions(undefined)).toEqual(zero);
  });
});

describe('useTransactionSearch summary', () => {
  let harness;

  beforeEach(() => {
    h.reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    harness?.unmount();
    harness = null;
    vi.useRealTimers();
  });

  it('命中數在上限內：直接以顯示列加總，且只發一次查詢', async () => {
    h.queue = [{ data: [row('income', 100), row('expense', 30)], count: 2, error: null }];
    harness = renderSearch({ userId: 'u1', query: '英國' });
    await settle();

    expect(h.calls).toHaveLength(1); // 未超上限 → 不重抓
    expect(harness.result.current.totalCount).toBe(2);
    expect(harness.result.current.results).toHaveLength(2);
    expect(harness.result.current.summary).toEqual({
      totalIncome: 100,
      totalExpense: 30,
      balance: 70,
    });
  });

  it('命中數超過上限：另發第二次查詢，總額涵蓋全部命中而非畫面那頁', async () => {
    h.queue = [
      // 第一次：帶 count 的那頁（畫面只拿到 1 筆，但總命中 250）
      { data: [row('expense', 30)], count: 250, error: null },
      // 第二次：抓齊全部命中，用來加總（金額與那頁刻意不同）
      {
        data: [row('income', 1000), row('expense', 30), row('expense', 20)],
        count: 250,
        error: null,
      },
    ];
    harness = renderSearch({ userId: 'u1', query: '英國' });
    await settle();

    expect(h.calls).toHaveLength(2);
    expect(h.calls[1].limit).toBe(250); // 第二次以總命中數為限額，抓齊全部
    expect(harness.result.current.totalCount).toBe(250);
    expect(harness.result.current.results).toHaveLength(1); // 清單仍是受限的那頁
    expect(harness.result.current.summary).toEqual({
      totalIncome: 1000,
      totalExpense: 50, // 30 + 20，來自全部命中，而非那頁的 30
      balance: 950,
    });
  });

  it('超過上限但第二次查詢失敗：退回以顯示列加總，不設 searchError', async () => {
    h.queue = [
      { data: [row('expense', 30), row('income', 10)], count: 250, error: null },
      { data: null, count: null, error: { message: 'boom2' } },
    ];
    harness = renderSearch({ userId: 'u1', query: '英國' });
    await settle();

    expect(h.calls).toHaveLength(2);
    expect(harness.result.current.searchError).toBe(null); // 第二次失敗被吞掉，不干擾主流程
    expect(harness.result.current.summary).toEqual({
      totalIncome: 10,
      totalExpense: 30,
      balance: -20,
    });
  });

  it('第一次查詢失敗：summary 歸零、設 searchError、清空結果', async () => {
    h.queue = [{ data: null, count: null, error: { message: 'boom' } }];
    harness = renderSearch({ userId: 'u1', query: '英國' });
    await settle();

    expect(harness.result.current.searchError).toBe('boom');
    expect(harness.result.current.results).toEqual([]);
    expect(harness.result.current.summary).toEqual({
      totalIncome: 0,
      totalExpense: 0,
      balance: 0,
    });
  });

  it('清空 query：summary 歸零且不發任何查詢', async () => {
    h.queue = [{ data: [row('income', 100)], count: 1, error: null }];
    harness = renderSearch({ userId: 'u1', query: '英國' });
    await settle();
    expect(h.calls).toHaveLength(1);

    harness.rerender({ userId: 'u1', query: '' });
    await settle(1000);
    expect(h.calls).toHaveLength(1); // 沒有新查詢
    expect(harness.result.current.summary).toEqual({
      totalIncome: 0,
      totalExpense: 0,
      balance: 0,
    });
  });
});
