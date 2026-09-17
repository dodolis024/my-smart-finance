import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

// React 18 的 act() 需要此旗標
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  rateResponse: { data: null, error: null },
  txInsertError: null, // transactions 的 insert 要回的 error（null = 成功）
  rpcCalls: [],
  inserts: {}, // table -> 收到的 insert payload 陣列
  reset() {
    this.rateResponse = { data: null, error: null };
    this.txInsertError = null;
    this.rpcCalls = [];
    this.inserts = {};
  },
}));

vi.mock('@/lib/supabase', () => {
  const makeBuilder = (table) => {
    const b = {
      select: () => b,
      eq: () => b,
      update: () => b,
      // fetcher 的 .select().eq().order() 以 await 結尾
      order: async () => ({ data: [], error: null }),
      // subscriptions 的 insert 走 .select('id').single()；accounts 查詢也走 .single()
      single: async () =>
        table === 'subscriptions'
          ? { data: { id: 'sub-1' }, error: null }
          : { data: null, error: null },
      insert: (payload) => {
        (h.inserts[table] ??= []).push(payload);
        // transactions 的 insert 直接被 await，需為 thenable
        b.then = (resolve) => { resolve({ error: table === 'transactions' ? h.txInsertError : null }); };
        return b;
      },
    };
    return b;
  };
  return {
    supabase: {
      from: (table) => makeBuilder(table),
      rpc: async (fn, args) => {
        h.rpcCalls.push({ fn, args });
        return h.rateResponse;
      },
    },
  };
});

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key }),
}));

import { useSubscriptions } from '@/hooks/useSubscriptions';
import { clearAllCaches } from '@/lib/resourceCache';
import { subscribeDataChanged } from '@/lib/dataEvents';

function renderSubscriptions() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const result = { current: null };
  function Harness() {
    result.current = useSubscriptions();
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

/** 與 hook 相同的台灣時間(UTC+8)基準，讓「今天」必為扣款日 */
function twTodayDay() {
  const tw = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return tw.getUTCDate();
}

/** 同一個台灣時鐘的 HH:MM；交易的 time 要跟 date 用同一個時鐘 */
function twNowHm() {
  const tw = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `${String(tw.getUTCHours()).padStart(2, '0')}:${String(tw.getUTCMinutes()).padStart(2, '0')}`;
}

function makeFormData(overrides = {}) {
  return {
    name: 'Netflix',
    amount: 9.99,
    currency: 'USD',
    category: null,
    payment_method: null,
    billing_cycle: 'monthly',
    renewal_month: null,
    renewal_day: twTodayDay(),
    is_active: true,
    ...overrides,
  };
}

describe('useSubscriptions.saveSubscription（新增且今天是扣款日）', () => {
  let harness;

  beforeEach(() => {
    h.reset();
    clearAllCaches();
  });

  afterEach(() => {
    harness?.unmount();
    harness = null;
  });

  it('查無匯率時保留訂閱但不建立交易，回傳 rateUnavailable', async () => {
    h.rateResponse = { data: null, error: null };
    harness = renderSubscriptions();
    const onTxChanged = vi.fn();
    const unsubscribe = subscribeDataChanged(onTxChanged);

    let result;
    await act(async () => {
      result = await harness.result.current.saveSubscription(makeFormData());
    });
    unsubscribe();

    // 訂閱本身照常插入
    expect(h.inserts.subscriptions).toHaveLength(1);
    // 匯率查無 → 不建立當日交易
    expect(h.inserts.transactions).toBeUndefined();
    expect(h.rpcCalls).toEqual([
      { fn: 'get_exchange_rate', args: { p_currency: 'USD' } },
    ]);
    expect(result).toEqual({ transactionCreated: false, rateUnavailable: true });
    // 沒建交易就不該通知儀表板重抓
    expect(onTxChanged).not.toHaveBeenCalled();
  });

  it('有匯率時建立當日交易且 twd_amount 四捨五入到 2 位', async () => {
    h.rateResponse = { data: 31.5, error: null };
    harness = renderSubscriptions();
    const onTxChanged = vi.fn();
    const unsubscribe = subscribeDataChanged(onTxChanged);

    const hmBefore = twNowHm();
    let result;
    await act(async () => {
      result = await harness.result.current.saveSubscription(makeFormData());
    });
    unsubscribe();
    const hmAfter = twNowHm();

    expect(h.inserts.subscriptions).toHaveLength(1);
    expect(h.inserts.transactions).toHaveLength(1);
    const tx = h.inserts.transactions[0];
    expect(tx.subscription_id).toBe('sub-1');
    // time 一定要帶：交給資料庫預設等於用 UTC 時鐘，會比台灣慢 8 小時。
    // 跨分鐘邊界時前後兩個值都算對
    expect([hmBefore, hmAfter]).toContain(tx.time);
    expect(tx.currency).toBe('USD');
    expect(tx.amount).toBe(9.99);
    expect(tx.exchange_rate).toBe(31.5);
    // 9.99 * 31.5 = 314.685 → 四捨五入到 2 位 = 314.69
    expect(tx.twd_amount).toBe(314.69);
    expect(result).toEqual({ transactionCreated: true });
    // 建了交易 → 通知已掛載的儀表板重抓（首頁不用手動刷新）
    expect(onTxChanged).toHaveBeenCalledTimes(1);
  });

  it('扣款交易寫入失敗時保留訂閱，回傳 transactionFailed 讓面板提示手動補記', async () => {
    h.rateResponse = { data: 31.5, error: null };
    h.txInsertError = { message: 'network error' };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    harness = renderSubscriptions();
    const onTxChanged = vi.fn();
    const unsubscribe = subscribeDataChanged(onTxChanged);

    let result;
    await act(async () => {
      result = await harness.result.current.saveSubscription(makeFormData());
    });
    unsubscribe();
    errorSpy.mockRestore();

    // 訂閱已存、交易試過但失敗：不能跟「今天不是扣款日」長得一樣，
    // 排程只在到期日跑一次，這一期不會被補上
    expect(h.inserts.subscriptions).toHaveLength(1);
    expect(h.inserts.transactions).toHaveLength(1);
    expect(result).toEqual({ transactionCreated: false, transactionFailed: true });
    expect(onTxChanged).not.toHaveBeenCalled();
  });
});
