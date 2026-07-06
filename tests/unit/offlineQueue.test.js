/**
 * 單元測試 - 離線記帳佇列(offlineQueue)
 * 涵蓋:入列/移除、補送成功、23505 冪等、失敗分類、斷網中斷、session 失效、single-flight
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  upsert: vi.fn(),
  rpc: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table) => (table === 'transactions' ? { insert: mocks.insert } : { upsert: mocks.upsert }),
    rpc: mocks.rpc,
    auth: { getSession: mocks.getSession },
  },
}));

import { enqueueTransaction, listQueue, removeQueued, flushQueue } from '@/lib/offlineQueue';

const USER_ID = 'user-1';

function makeTx(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    user_id: USER_ID,
    date: '2026-07-06',
    type: 'expense',
    item_name: '咖啡',
    category: '飲食',
    payment_method: '現金',
    account_id: 'acc-1',
    currency: 'TWD',
    amount: 100,
    exchange_rate: 1,
    twd_amount: 100,
    note: null,
    ...overrides,
  };
}

// 注意:vitest jsdom 的全域 navigator 與 window.navigator 是不同物件,
// 受測模組讀的是全域 navigator,必須覆寫 globalThis 上的那份
function setOnline(value) {
  Object.defineProperty(globalThis.navigator, 'onLine', { configurable: true, get: () => value });
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  setOnline(true);
  mocks.getSession.mockResolvedValue({ data: { session: { user: { id: USER_ID } } } });
  mocks.insert.mockResolvedValue({ error: null });
  mocks.upsert.mockResolvedValue({ error: null });
});

afterEach(() => {
  delete globalThis.navigator.onLine;
});

describe('offlineQueue - 入列與移除', () => {
  it('入列後可讀回,移除後清空', () => {
    const tx = makeTx();
    enqueueTransaction(USER_ID, tx, '2026-07-06');

    const items = listQueue(USER_ID);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(tx.id);
    expect(items[0].status).toBe('pending');
    expect(items[0].enqueuedOn).toBe('2026-07-06');

    removeQueued(USER_ID, tx.id);
    expect(listQueue(USER_ID)).toHaveLength(0);
  });

  it('不同使用者的佇列彼此隔離', () => {
    enqueueTransaction(USER_ID, makeTx(), '2026-07-06');
    expect(listQueue('user-2')).toHaveLength(0);
  });
});

describe('offlineQueue - flush', () => {
  it('補送成功:insert 帶入完整 payload,項目出列', async () => {
    const tx = makeTx();
    enqueueTransaction(USER_ID, tx, '2026-07-06');

    const result = await flushQueue(USER_ID);

    expect(result.synced).toBe(1);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ id: tx.id, twd_amount: 100 }));
    expect(listQueue(USER_ID)).toHaveLength(0);
  });

  it('交易日期等於入列日時補簽到(記在入列日)', async () => {
    enqueueTransaction(USER_ID, makeTx({ date: '2026-07-05' }), '2026-07-05');
    await flushQueue(USER_ID);

    expect(mocks.upsert).toHaveBeenCalledWith(
      { user_id: USER_ID, date: '2026-07-05', source: 'onTimeTransaction' },
      { onConflict: 'user_id,date' }
    );
  });

  it('補記過去日期的交易不觸發簽到', async () => {
    enqueueTransaction(USER_ID, makeTx({ date: '2026-07-01' }), '2026-07-06');
    await flushQueue(USER_ID);

    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('23505 重複鍵視為已同步(冪等,不重複記帳)', async () => {
    enqueueTransaction(USER_ID, makeTx(), '2026-07-06');
    mocks.insert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } });

    const result = await flushQueue(USER_ID);

    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);
    expect(listQueue(USER_ID)).toHaveLength(0);
  });

  it('其他錯誤標記為 failed 保留,預設不重試,includeFailed 才重試', async () => {
    enqueueTransaction(USER_ID, makeTx(), '2026-07-06');
    mocks.insert.mockResolvedValueOnce({ error: { code: '42501', message: 'RLS violation' } });

    const result = await flushQueue(USER_ID);
    expect(result.failed).toBe(1);
    const items = listQueue(USER_ID);
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe('failed');
    expect(items[0].errorMessage).toContain('RLS');

    // 預設 flush 跳過 failed 項目
    mocks.insert.mockClear();
    await flushQueue(USER_ID);
    expect(mocks.insert).not.toHaveBeenCalled();

    // includeFailed 重試並成功出列
    const retry = await flushQueue(USER_ID, { includeFailed: true });
    expect(retry.synced).toBe(1);
    expect(listQueue(USER_ID)).toHaveLength(0);
  });

  it('補送途中斷網:中斷並保留剩餘項目', async () => {
    enqueueTransaction(USER_ID, makeTx(), '2026-07-06');
    enqueueTransaction(USER_ID, makeTx(), '2026-07-06');
    mocks.insert.mockResolvedValue({ error: { code: '', message: 'TypeError: Failed to fetch' } });

    const result = await flushQueue(USER_ID);

    expect(result.offline).toBe(true);
    expect(result.synced).toBe(0);
    expect(listQueue(USER_ID)).toHaveLength(2);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  it('離線時不嘗試補送', async () => {
    setOnline(false);
    enqueueTransaction(USER_ID, makeTx(), '2026-07-06');

    const result = await flushQueue(USER_ID);

    expect(result.offline).toBe(true);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(listQueue(USER_ID)).toHaveLength(1);
  });

  it('session 失效:佇列原封保留,回報 needsLogin', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    enqueueTransaction(USER_ID, makeTx(), '2026-07-06');

    const result = await flushQueue(USER_ID);

    expect(result.needsLogin).toBe(true);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(listQueue(USER_ID)).toHaveLength(1);
  });

  it('入列時無匯率的項目在補送前解析匯率並換算台幣', async () => {
    enqueueTransaction(
      USER_ID,
      makeTx({ currency: 'JPY', amount: 1000, exchange_rate: null, twd_amount: null }),
      '2026-07-06'
    );
    mocks.rpc.mockResolvedValue({ data: 0.21, error: null });

    const result = await flushQueue(USER_ID);

    expect(result.synced).toBe(1);
    expect(mocks.rpc).toHaveBeenCalledWith('get_exchange_rate', { p_currency: 'JPY' });
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ exchange_rate: 0.21, twd_amount: 210 })
    );
  });

  it('single-flight:並發呼叫共用同一個進行中的 flush', async () => {
    enqueueTransaction(USER_ID, makeTx(), '2026-07-06');
    let resolveInsert;
    mocks.insert.mockReturnValue(new Promise((resolve) => { resolveInsert = resolve; }));

    const p1 = flushQueue(USER_ID);
    const p2 = flushQueue(USER_ID);
    expect(p1).toBe(p2);

    resolveInsert({ error: null });
    const result = await p1;
    expect(result.synced).toBe(1);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });
});
