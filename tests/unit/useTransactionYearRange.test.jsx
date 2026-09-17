import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * 交易年份範圍（期間選擇器淡化年份用）。
 *
 * 守三件事：
 * 1. 同一位使用者只查一次，切頁回來走快取
 * 2. 記帳／刪帳後 invalidate，已掛載的頁面要重查並拿到新範圍（新年第一筆帳）
 * 3. 查詢失敗不寫快取、不把已知範圍洗成 null
 */

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const db = vi.hoisted(() => ({
  // ascending → 最早一筆；descending → 最新一筆
  minDate: '2024-03-01',
  maxDate: '2025-12-31',
  fail: false,
  queries: 0,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => {
      let ascending = true;
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: (_col, opts) => { ascending = opts.ascending; return chain; },
        limit: () => {
          db.queries += 1;
          if (db.fail) return Promise.resolve({ data: null, error: new Error('offline') });
          const date = ascending ? db.minDate : db.maxDate;
          return Promise.resolve({ data: date ? [{ date }] : [], error: null });
        },
      };
      return chain;
    },
  },
}));

let mod;
let container;
let root;
const result = { current: undefined };

function Probe({ userId }) {
  result.current = mod.useTransactionYearRange(userId);
  return null;
}

async function mount(userId = 'user-1') {
  container = document.createElement('div');
  root = createRoot(container);
  await act(async () => { root.render(createElement(Probe, { userId })); });
}

async function unmount() {
  await act(async () => { root.unmount(); });
  root = null;
}

beforeEach(async () => {
  // 快取是模組層狀態，每個測試重新載入一份乾淨的模組
  vi.resetModules();
  mod = await import('@/hooks/useTransactionYearRange');
  Object.assign(db, { minDate: '2024-03-01', maxDate: '2025-12-31', fail: false, queries: 0 });
});

afterEach(async () => {
  if (root) await unmount();
});

describe('useTransactionYearRange', () => {
  it('查出最早與最新一筆的年份', async () => {
    await mount();
    expect(result.current).toEqual({ minYear: 2024, maxYear: 2025 });
  });

  it('同一位使用者重新掛載走快取，不再查詢', async () => {
    await mount();
    await unmount();
    const before = db.queries;

    await mount();
    expect(result.current).toEqual({ minYear: 2024, maxYear: 2025 });
    expect(db.queries).toBe(before);
  });

  it('invalidate 後已掛載的頁面重查，新年第一筆帳記完就進到範圍裡', async () => {
    await mount();
    expect(result.current).toEqual({ minYear: 2024, maxYear: 2025 });

    db.maxDate = '2026-01-01';
    await act(async () => { mod.invalidateTransactionYearRange('user-1'); });

    expect(result.current).toEqual({ minYear: 2024, maxYear: 2026 });
  });

  it('invalidate 別人的帳號不影響目前使用者的快取', async () => {
    await mount();
    await unmount();
    const before = db.queries;

    mod.invalidateTransactionYearRange('someone-else');
    await mount();
    expect(db.queries).toBe(before);
  });

  it('重查失敗時保留原本的範圍，不洗成 null', async () => {
    await mount();
    db.fail = true;
    await act(async () => { mod.invalidateTransactionYearRange('user-1'); });

    expect(result.current).toEqual({ minYear: 2024, maxYear: 2025 });
  });

  it('沒有任何交易回 null（所有過去年份都可選）', async () => {
    db.minDate = null;
    db.maxDate = null;
    await mount();
    expect(result.current).toBeNull();
  });
});
