import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

// React 18 的 act() 需要此旗標
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  response: { data: [], error: null },
  orExprs: [],
  queryCount: 0,
  reset() {
    this.response = { data: [], error: null };
    this.orExprs = [];
    this.queryCount = 0;
  },
}));

vi.mock('@/lib/supabase', () => {
  const makeBuilder = () => {
    const b = {
      select: () => b,
      eq: () => b,
      or: (expr) => {
        h.orExprs.push(expr);
        return b;
      },
      order: () => b,
      limit: async () => {
        h.queryCount += 1;
        return h.response;
      },
    };
    return b;
  };
  return { supabase: { from: () => makeBuilder() } };
});

import {
  useTransactionSearch,
  sanitizeSearchQuery,
  mapSearchRow,
} from '@/hooks/useTransactionSearch';

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

describe('sanitizeSearchQuery', () => {
  it('PostgREST 保留字元以空白取代、LIKE 萬用字元跳脫', () => {
    expect(sanitizeSearchQuery('a,b(c)"d\\e')).toBe('a b c  d e');
    expect(sanitizeSearchQuery('100%_off')).toBe('100\\%\\_off');
    expect(sanitizeSearchQuery('  ,() ')).toBe('');
    expect(sanitizeSearchQuery(null)).toBe('');
  });
});

describe('mapSearchRow', () => {
  it('蛇形 → RPC 駝峰形狀（amount → originalAmount）', () => {
    const mapped = mapSearchRow({
      id: 'x1',
      date: '2026-06-15',
      type: 'expense',
      category: '飲食',
      item_name: '拿鐵',
      payment_method: '信用卡A',
      currency: 'USD',
      amount: 4.5,
      exchange_rate: 30,
      twd_amount: 135,
      note: null,
    });
    expect(mapped).toEqual({
      id: 'x1',
      date: '2026-06-15',
      type: 'expense',
      category: '飲食',
      itemName: '拿鐵',
      paymentMethod: '信用卡A',
      currency: 'USD',
      originalAmount: 4.5,
      exchangeRate: 30,
      twdAmount: 135,
      note: null,
    });
    expect(mapped.isSplitSynced).toBeUndefined();
  });
});

describe('useTransactionSearch', () => {
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

  it('debounce 300ms：299ms 不發請求，300ms 發出且結果映射為駝峰', async () => {
    h.response = {
      data: [
        {
          id: 'a',
          date: '2026-05-01',
          type: 'expense',
          category: '飲食',
          item_name: '拿鐵',
          payment_method: '現金',
          currency: 'TWD',
          amount: 120,
          exchange_rate: 1,
          twd_amount: 120,
          note: '',
        },
      ],
      error: null,
    };
    harness = renderSearch({ userId: 'u1', query: '拿鐵' });
    expect(h.queryCount).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(h.queryCount).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(h.queryCount).toBe(1);
    expect(harness.result.current.searching).toBe(false);
    expect(harness.result.current.results).toHaveLength(1);
    expect(harness.result.current.results[0].itemName).toBe('拿鐵');
    expect(harness.result.current.results[0].originalAmount).toBe(120);
  });

  it('or 條件涵蓋四欄且搜尋字已消毒', async () => {
    harness = renderSearch({ userId: 'u1', query: 'x,y(z)%' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(h.orExprs).toHaveLength(1);
    const expr = h.orExprs[0];
    for (const col of ['item_name', 'category', 'note', 'payment_method']) {
      expect(expr).toContain(`${col}.ilike.%`);
    }
    expect(expr).toContain('\\%'); // % 已跳脫
    expect(expr).not.toContain('('); // 保留字元已移除
  });

  it('query 清空時歸零且不發請求', async () => {
    harness = renderSearch({ userId: 'u1', query: '拿鐵' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(h.queryCount).toBe(1);

    harness.rerender({ userId: 'u1', query: '' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(h.queryCount).toBe(1); // 沒有新請求
    expect(harness.result.current.results).toEqual([]);
    expect(harness.result.current.searching).toBe(false);
    expect(harness.result.current.searchError).toBe(null);
  });

  it('查詢失敗時設定 searchError 並清空結果；refresh 重跑', async () => {
    h.response = { data: null, error: { message: 'boom' } };
    harness = renderSearch({ userId: 'u1', query: '拿鐵' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(harness.result.current.searchError).toBe('boom');
    expect(harness.result.current.results).toEqual([]);

    h.response = { data: [], error: null };
    await act(async () => {
      harness.result.current.refresh();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.queryCount).toBe(2);
    expect(harness.result.current.searchError).toBe(null);
  });
});
