import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 線上新增 → 離線佇列的交接。
 * 守的是「insert 已寫入但回應掉包」這條路：轉入佇列的 payload 必須沿用線上送出的 id,
 * 補送才會撞上 Postgres 23505 被 offlineQueue 認定為已同步,而不是把同一筆帳記成兩筆。
 */

const mocks = vi.hoisted(() => ({
  writes: [],
  insertError: null,
  rpc: vi.fn(),
  enqueued: [],
}));

function builder(table) {
  const b = {};
  for (const m of ['select', 'eq']) b[m] = () => b;
  b.maybeSingle = () => Promise.resolve({ data: null, error: null });
  b.single = b.maybeSingle;
  for (const op of ['insert', 'update', 'upsert']) {
    b[op] = (payload) => {
      mocks.writes.push({ table, op, payload });
      b.__error = op === 'insert' && table === 'transactions' ? mocks.insertError : null;
      return b;
    };
  }
  b.then = (resolve) => resolve({ error: b.__error ?? null });
  return b;
}

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (table) => builder(table), rpc: (...args) => mocks.rpc(...args) },
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k) => k }) }));
vi.mock('@/lib/offlineCache', async (importOriginal) => ({
  // isOfflineError 用真實實作:這個測試的前提就是「Failed to fetch 會被判成離線」
  ...(await importOriginal()),
  loadRates: () => ({ GBP: 42.035 }),
  loadAccounts: () => [],
}));
vi.mock('@/lib/offlineQueue', () => ({
  enqueueTransaction: (_uid, tx) => {
    mocks.enqueued.push(tx);
    return true;
  },
}));

const { useTransactions } = await import('@/hooks/useTransactions');

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
  paymentMethod: '現金',
  currency: 'TWD',
  amount: '120',
  note: '',
  ...over,
});

const lastInsert = () =>
  [...mocks.writes].reverse().find((w) => w.table === 'transactions' && w.op === 'insert')?.payload;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

beforeEach(() => {
  mocks.writes.length = 0;
  mocks.enqueued.length = 0;
  mocks.insertError = null;
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

describe('線上新增的交易 id', () => {
  it('insert payload 自帶客戶端 UUID,不靠資料庫預設值', async () => {
    await submit(form());
    expect(lastInsert().id).toMatch(UUID_RE);
  });

  it('每筆都是新的 id', async () => {
    await submit(form());
    const first = lastInsert().id;
    await submit(form());
    expect(lastInsert().id).not.toBe(first);
  });
});

describe('insert 回應掉包 → 轉入離線佇列', () => {
  it('入列的 id 沿用線上送出的那一個', async () => {
    mocks.insertError = { message: 'Failed to fetch' };

    const result = await submit(form());

    expect(result).toMatchObject({ queued: true });
    expect(mocks.enqueued).toHaveLength(1);
    expect(mocks.enqueued[0].id).toBe(lastInsert().id);
  });

  it('外幣沿用已取到的匯率入列,id 同樣不換', async () => {
    mocks.insertError = { message: 'Load failed' };

    await submit(form({ currency: 'GBP', amount: '10' }));

    expect(mocks.enqueued[0]).toMatchObject({ id: lastInsert().id, exchange_rate: 42.035 });
  });

  it('不是離線錯誤就照常拋出,不入列', async () => {
    mocks.insertError = { message: 'permission denied', code: '42501' };

    await expect(submit(form())).rejects.toMatchObject({ message: 'permission denied' });
    expect(mocks.enqueued).toHaveLength(0);
  });
});

describe('一開始就離線', () => {
  it('直接入列,id 是客戶端產生的 UUID', async () => {
    Object.defineProperty(globalThis.navigator, 'onLine', { configurable: true, get: () => false });

    await submit(form());

    expect(mocks.writes).toHaveLength(0);
    expect(mocks.enqueued[0].id).toMatch(UUID_RE);
  });
});
