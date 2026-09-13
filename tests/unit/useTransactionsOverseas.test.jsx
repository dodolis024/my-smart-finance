import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 網頁版寫入的海外手續費（tools/core/transactions.js 有對應的 CLI 測試）。
 * 守兩件事：編輯時同帳戶沿用當時的費率；取消勾選一定把手續費欄位寫回 null。
 */

const mocks = vi.hoisted(() => ({
  results: {},
  writes: [],
  rpc: vi.fn(),
  cachedAccounts: [],
  enqueued: [],
}));

function builder(table) {
  const b = {};
  for (const m of ['select', 'eq']) b[m] = () => b;
  b.maybeSingle = () => Promise.resolve(mocks.results[table] ?? { data: null, error: null });
  b.single = b.maybeSingle;
  for (const op of ['insert', 'update', 'upsert']) {
    b[op] = (payload) => {
      mocks.writes.push({ table, op, payload });
      return b;
    };
  }
  b.then = (resolve) => resolve({ error: null });
  return b;
}

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (table) => builder(table), rpc: (...args) => mocks.rpc(...args) },
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k) => k }) }));
vi.mock('@/lib/offlineCache', () => ({
  loadRates: () => ({ GBP: 42.035 }),
  loadAccounts: () => mocks.cachedAccounts,
  isOfflineError: () => false,
}));
vi.mock('@/lib/offlineQueue', () => ({
  enqueueTransaction: (_uid, tx) => {
    mocks.enqueued.push(tx);
    return true;
  },
}));

const { useTransactions } = await import('@/hooks/useTransactions');

const CARD = { id: 'acc-2', type: 'credit_card', overseas_fee_rate: 1.5 };

let submit;
let container;
let root;

function Harness() {
  submit = useTransactions().submitTransaction;
  return null;
}

const form = (over = {}) => ({
  date: '2026-09-01',
  time: '12:00',
  itemName: '午餐',
  categoryValue: 'expense:飲食',
  paymentMethod: '英國卡',
  currency: 'GBP',
  amount: '10',
  note: '',
  overseas: true,
  ...over,
});

const lastWrite = (op) => [...mocks.writes].reverse().find((w) => w.table === 'transactions' && w.op === op)?.payload;

beforeEach(() => {
  mocks.results = { accounts: { data: CARD, error: null } };
  mocks.writes.length = 0;
  mocks.enqueued.length = 0;
  mocks.cachedAccounts = [];
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: 42.035, error: null });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(Harness)));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Object.defineProperty(globalThis.navigator, 'onLine', { configurable: true, get: () => true });
});

describe('新增', () => {
  it('勾選海外 → twd_amount 含手續費，另存費率與手續費', async () => {
    await submit(form());
    expect(lastWrite('insert')).toMatchObject({ twd_amount: 426.66, overseas_fee_rate: 1.5, overseas_fee: 6.31 });
  });

  it('沒勾 → 手續費欄位為 null', async () => {
    await submit(form({ overseas: false }));
    expect(lastWrite('insert')).toMatchObject({ twd_amount: 420.35, overseas_fee_rate: null, overseas_fee: null });
  });

  it('收入即使 overseas 為 true 也不算', async () => {
    await submit(form({ categoryValue: 'income:薪水' }));
    expect(lastWrite('insert')).toMatchObject({ type: 'income', twd_amount: 420.35, overseas_fee: null });
  });

  it('帳戶沒有費率 → 不算', async () => {
    mocks.results.accounts = { data: { id: 'acc-9', type: 'cash', overseas_fee_rate: null }, error: null };
    await submit(form());
    expect(lastWrite('insert')).toMatchObject({ twd_amount: 420.35, overseas_fee: null });
  });

  it('離線新增用快取帳戶的費率算好再入列', async () => {
    Object.defineProperty(globalThis.navigator, 'onLine', { configurable: true, get: () => false });
    mocks.cachedAccounts = [{ id: 'acc-2', accountName: '英國卡', type: 'credit_card', overseasFeeRate: 1.5 }];

    await submit(form());

    expect(mocks.enqueued[0]).toMatchObject({ twd_amount: 426.66, overseas_fee_rate: 1.5, overseas_fee: 6.31 });
  });
});

describe('編輯', () => {
  const existing = { currency: 'GBP', exchange_rate: 42.035, account_id: 'acc-2', overseas_fee_rate: 1.5 };

  it('同帳戶、原本是海外 → 沿用當時的 1.5%（卡片現在是 1.2% 也一樣）', async () => {
    mocks.results.transactions = { data: existing, error: null };
    mocks.results.accounts = { data: { ...CARD, overseas_fee_rate: 1.2 }, error: null };

    await submit(form({ amount: '20' }), 'tx-1');

    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(lastWrite('update')).toMatchObject({ twd_amount: 853.31, overseas_fee_rate: 1.5, overseas_fee: 12.61 });
  });

  it('取消勾選 → 手續費欄位寫回 null', async () => {
    mocks.results.transactions = { data: existing, error: null };

    await submit(form({ overseas: false }), 'tx-1');

    const payload = lastWrite('update');
    expect(payload).toHaveProperty('overseas_fee_rate', null);
    expect(payload).toHaveProperty('overseas_fee', null);
    expect(payload.twd_amount).toBe(420.35);
  });

  it('換到另一張卡 → 用新卡目前的費率', async () => {
    mocks.results.transactions = { data: existing, error: null };
    mocks.results.accounts = { data: { id: 'acc-3', type: 'debit_card', overseas_fee_rate: 2 }, error: null };

    await submit(form({ paymentMethod: '手動卡' }), 'tx-1');

    expect(lastWrite('update')).toMatchObject({ account_id: 'acc-3', overseas_fee_rate: 2, overseas_fee: 8.41 });
  });

  it('分帳同步交易 → 不算手續費', async () => {
    mocks.results.transactions = { data: { ...existing, overseas_fee_rate: null }, error: null };

    await submit(form(), 'tx-1', { isSplitSynced: true });

    expect(lastWrite('update')).toMatchObject({ overseas_fee_rate: null, overseas_fee: null });
  });
});
