import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 記帳送出時，帳戶查詢與讀原交易／取匯率同時發出。
 * 守的是：請求確實重疊、寫入內容不變，以及提早結束的路徑不會留下未處理的拒絕。
 */

const h = vi.hoisted(() => ({ pending: [], writes: [], enqueued: [] }));

function request(label) {
  return new Promise((resolve) => h.pending.push({ label, resolve }));
}

vi.mock('@/lib/supabase', () => {
  const makeBuilder = (table) => {
    let p = null;
    let op = 'select';
    const b = {
      select: () => b,
      eq: () => b,
      maybeSingle: () => b,
      single: () => b,
      insert: (payload) => { op = 'insert'; h.writes.push({ table, op, payload }); return b; },
      update: (payload) => { op = 'update'; h.writes.push({ table, op, payload }); return b; },
      upsert: (payload) => { op = 'upsert'; h.writes.push({ table, op, payload }); return b; },
      then: (res, rej) => {
        p ??= op === 'select' ? request(`select:${table}`) : Promise.resolve({ error: null });
        return p.then(res, rej);
      },
    };
    return b;
  };
  return {
    supabase: {
      from: (table) => makeBuilder(table),
      rpc: (fn) => request(`rpc:${fn}`),
    },
  };
});
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k) => k }) }));
vi.mock('@/lib/offlineCache', async (importOriginal) => ({
  ...(await importOriginal()),
  loadRates: () => ({ GBP: 42 }),
  loadAccounts: () => [],
}));
vi.mock('@/lib/offlineQueue', () => ({
  enqueueTransaction: (_uid, tx) => { h.enqueued.push(tx); return true; },
}));

const { useTransactions } = await import('@/hooks/useTransactions');

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));
const labels = () => h.pending.map((x) => x.label).sort();

function respond(label, response) {
  const i = h.pending.findIndex((x) => x.label === label);
  const [item] = h.pending.splice(i, 1);
  item.resolve(response instanceof Error ? Promise.reject(response) : response);
}

const CARD = { id: 'acc-1', type: 'credit_card', overseas_fee_rate: 1.5 };

const form = (over = {}) => ({
  date: '2020-01-01',
  time: '12:00',
  itemName: '午餐',
  categoryValue: 'expense:飲食',
  paymentMethod: 'Cube',
  currency: 'GBP',
  amount: '10',
  note: '',
  ...over,
});

let submit;
let root;
let container;
const unhandled = [];
const onUnhandled = (e) => unhandled.push(e);

beforeEach(() => {
  h.pending.length = 0;
  h.writes.length = 0;
  h.enqueued.length = 0;
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  function Harness() {
    submit = useTransactions().submitTransaction;
    return null;
  }
  act(() => root.render(createElement(Harness)));
});

afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
  act(() => root.unmount());
  container.remove();
});

const lastWrite = (table, op) =>
  [...h.writes].reverse().find((w) => w.table === table && w.op === op)?.payload;

describe('新增外幣', () => {
  it('匯率與帳戶同時查詢，寫入內容與依序查詢時相同', async () => {
    const p = submit(form({ overseas: true }));
    await flush();
    expect(labels()).toEqual(['rpc:get_exchange_rate', 'select:accounts']);

    respond('select:accounts', { data: CARD, error: null });
    respond('rpc:get_exchange_rate', { data: 42.105263, error: null });
    await p;

    expect(lastWrite('transactions', 'insert')).toMatchObject({
      account_id: 'acc-1',
      currency: 'GBP',
      amount: 10,
      exchange_rate: 42.105263,
      overseas_fee_rate: 1.5,
      overseas_fee: 6.32,
      twd_amount: 427.37,
    });
  });

  it('帳戶比匯率早回來也一樣', async () => {
    const p = submit(form());
    await flush();
    respond('rpc:get_exchange_rate', { data: 40, error: null });
    await flush();
    respond('select:accounts', { data: CARD, error: null });
    await p;
    expect(lastWrite('transactions', 'insert')).toMatchObject({ account_id: 'acc-1', twd_amount: 400 });
  });

  it('匯率因斷網失敗轉入離線佇列，未回應的帳戶查詢不留下未處理的拒絕', async () => {
    const p = submit(form());
    await flush();
    respond('rpc:get_exchange_rate', { data: null, error: { message: 'Failed to fetch' } });
    const result = await p;
    expect(result).toMatchObject({ queued: true });

    respond('select:accounts', new Error('Failed to fetch'));
    await flush();
    expect(unhandled).toEqual([]);
  });

  it('查無匯率照樣擋下', async () => {
    const p = submit(form());
    await flush();
    respond('select:accounts', { data: CARD, error: null });
    respond('rpc:get_exchange_rate', { data: null, error: null });
    await expect(p).rejects.toThrow('transaction.rateUnavailable');
    expect(lastWrite('transactions', 'insert')).toBeUndefined();
  });
});

describe('新增台幣', () => {
  it('只查帳戶，不查匯率', async () => {
    const p = submit(form({ currency: 'TWD', amount: '120' }));
    await flush();
    expect(labels()).toEqual(['select:accounts']);
    respond('select:accounts', { data: CARD, error: null });
    await p;
    expect(lastWrite('transactions', 'insert')).toMatchObject({ account_id: 'acc-1', twd_amount: 120 });
  });

  it('沒選支付方式時不查帳戶', async () => {
    const p = submit(form({ currency: 'TWD', paymentMethod: '' }), 'tx-1', { isSplitSynced: true });
    await flush();
    expect(labels()).toEqual(['select:transactions']);
    respond('select:transactions', { data: { currency: 'TWD', exchange_rate: 1 }, error: null });
    await p;
    expect(lastWrite('transactions', 'update')).toMatchObject({ account_id: null });
  });
});

describe('編輯', () => {
  it('讀原交易與帳戶同時查詢；幣別沒變就不取匯率', async () => {
    const p = submit(form({ overseas: true }), 'tx-1');
    await flush();
    expect(labels()).toEqual(['select:accounts', 'select:transactions']);

    respond('select:transactions', {
      data: { currency: 'GBP', exchange_rate: 41, account_id: 'acc-1', overseas_fee_rate: 3 },
      error: null,
    });
    respond('select:accounts', { data: CARD, error: null });
    await p;

    // 沿用原匯率與原費率（同一張卡），不受今天的卡片設定影響
    expect(lastWrite('transactions', 'update')).toMatchObject({
      exchange_rate: 41,
      overseas_fee_rate: 3,
      overseas_fee: 12.3,
      twd_amount: 422.3,
    });
    expect(h.pending).toEqual([]);
  });

  it('換了幣別才補取匯率，帳戶查詢不會重發', async () => {
    const p = submit(form({ currency: 'JPY', amount: '1000' }), 'tx-1');
    await flush();
    respond('select:transactions', { data: { currency: 'GBP', exchange_rate: 41, account_id: 'acc-1' }, error: null });
    await flush();
    expect(labels()).toEqual(['rpc:get_exchange_rate', 'select:accounts']);
    respond('rpc:get_exchange_rate', { data: 0.21, error: null });
    respond('select:accounts', { data: CARD, error: null });
    await p;
    expect(lastWrite('transactions', 'update')).toMatchObject({ exchange_rate: 0.21, twd_amount: 210 });
  });
});
