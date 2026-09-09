/**
 * 單元測試 - useOfflineSync 的自動補送時機
 * 重點:手機把 App 切到背景時頁面會被凍結,恢復連線的 'online' 事件收不到,
 * 因此「回到前景」(visibilitychange / pageshow)必須也是補送時機,
 * 否則待同步的帳會卡到使用者重開 App 或手動點補送為止。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  upsert: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table) => (table === 'transactions' ? { insert: mocks.insert } : { upsert: mocks.upsert }),
    rpc: async () => ({ data: 1, error: null }),
    auth: { getSession: mocks.getSession },
  },
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

import { useOfflineSync } from '@/hooks/useOfflineSync';
import { enqueueTransaction, listQueue, clearQueue } from '@/lib/offlineQueue';

const USER_ID = 'user-1';

function makeTx() {
  return {
    id: crypto.randomUUID(),
    user_id: USER_ID,
    date: '2026-09-08',
    time: '21:30',
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
  };
}

function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

let container;
let root;

// 入列會透過 subscribeQueue 通知已掛載的 hook 更新 state,要包在 act 裡
function enqueue() {
  act(() => {
    enqueueTransaction(USER_ID, makeTx(), '2026-09-08');
  });
}

function mountHook(options) {
  function Probe() {
    useOfflineSync(options);
    return null;
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(Probe)));
}

beforeEach(() => {
  clearQueue(USER_ID);
  mocks.insert.mockReset().mockResolvedValue({ error: null });
  mocks.upsert.mockReset().mockResolvedValue({ error: null });
  mocks.getSession.mockReset().mockResolvedValue({ data: { session: { user: { id: USER_ID } } } });
  setVisibility('visible');
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  clearQueue(USER_ID);
});

describe('useOfflineSync 自動補送時機', () => {
  it('回到前景(visibilitychange → visible)時補送佇列', async () => {
    mountHook();
    enqueue();

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(listQueue(USER_ID)).toHaveLength(0);
  });

  it('頁面切到背景(hidden)時不補送', async () => {
    mountHook();
    enqueue();
    setVisibility('hidden');

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(mocks.insert).not.toHaveBeenCalled();
    expect(listQueue(USER_ID)).toHaveLength(1);
  });

  it('bfcache 還原(pageshow)時補送佇列', async () => {
    mountHook();
    enqueue();

    await act(async () => {
      window.dispatchEvent(new Event('pageshow'));
    });

    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(listQueue(USER_ID)).toHaveLength(0);
  });

  it('恢復連線(online)時補送佇列', async () => {
    mountHook();
    enqueue();

    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });

    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(listQueue(USER_ID)).toHaveLength(0);
  });

  it('掛載時佇列非空就補送', async () => {
    enqueue();

    await act(async () => {
      mountHook();
    });

    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  it('autoFlush: false 的實例不參與任何自動補送', async () => {
    mountHook({ autoFlush: false });
    enqueue();

    await act(async () => {
      window.dispatchEvent(new Event('online'));
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pageshow'));
    });

    expect(mocks.insert).not.toHaveBeenCalled();
    expect(listQueue(USER_ID)).toHaveLength(1);
  });

  it('autoFlush: false 仍可手動補送(儀表板的「待同步」藥丸)', async () => {
    let api;
    function Probe() {
      api = useOfflineSync({ autoFlush: false });
      return null;
    }
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(createElement(Probe)));

    enqueue();
    await act(async () => {
      await api.flushNow();
    });

    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(listQueue(USER_ID)).toHaveLength(0);
  });
});
