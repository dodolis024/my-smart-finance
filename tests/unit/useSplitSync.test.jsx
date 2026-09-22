import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

// React 18 的 act() 需要此旗標
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 分帳同步到帳本。
 *
 * 守的是「新建交易的時間由前端帶」：sync_split_to_ledger 的 p_time 沒帶時，
 * 資料庫只能用自己的時鐘，而它是 UTC，存出來的時間比台灣慢 8 小時。
 */

const h = vi.hoisted(() => ({
  rpcCalls: [],
  syncResponse: { data: { success: true, created: 1 }, error: null },
  statusResponse: { data: { synced: true, needs_update: false }, error: null },
  setExcludedResponse: { data: { success: true, removed: 0 }, error: null },
  holds: {},
  reset() {
    this.holds = {};
    this.rpcCalls = [];
    this.syncResponse = { data: { success: true, created: 1 }, error: null };
    this.statusResponse = { data: { synced: true, needs_update: false }, error: null };
    this.setExcludedResponse = { data: { success: true, removed: 0 }, error: null };
  },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: async (fn, args) => {
      h.rpcCalls.push({ fn, args });
      if (h.holds[fn]) await h.holds[fn];
      if (fn === 'sync_split_to_ledger') return h.syncResponse;
      if (fn === 'set_split_sync_excluded') return h.setExcludedResponse;
      return h.statusResponse;
    },
  },
}));

import { useSplitSync, EXCLUSION_SUMMARY_DELAY_MS } from '@/hooks/useSplitSync';

const GROUP_ID = 'group-1';

function renderSplitSync(options) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const result = { current: null };
  function Harness() {
    result.current = useSplitSync(GROUP_ID, options);
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

describe('useSplitSync.syncToLedger', () => {
  let harness;

  beforeEach(() => {
    h.reset();
  });

  afterEach(() => {
    harness?.unmount();
    harness = null;
  });

  it('同步時帶裝置本地時間 p_time，成功後重抓同步狀態', async () => {
    harness = renderSplitSync();

    let result;
    await act(async () => {
      result = await harness.result.current.syncToLedger();
    });

    expect(h.rpcCalls).toHaveLength(2);
    expect(h.rpcCalls[0].fn).toBe('sync_split_to_ledger');
    expect(h.rpcCalls[0].args.p_group_id).toBe(GROUP_ID);
    // HH:MM，與手動記帳表單的 getNowHm 同一個格式與時鐘
    expect(h.rpcCalls[0].args.p_time).toMatch(/^\d{2}:\d{2}$/);
    expect(h.rpcCalls[1]).toEqual({ fn: 'get_split_sync_status', args: { p_group_id: GROUP_ID } });
    expect(result).toEqual({ success: true, created: 1 });
    expect(harness.result.current.syncStatus).toEqual({ synced: true, needs_update: false });
    expect(harness.result.current.syncing).toBe(false);
  });

  it('RPC 失敗時拋出錯誤且不重抓狀態', async () => {
    h.syncResponse = { data: null, error: new Error('SPLIT_RATE_UNAVAILABLE') };
    harness = renderSplitSync();

    let caught = null;
    await act(async () => {
      try {
        await harness.result.current.syncToLedger();
      } catch (e) {
        caught = e;
      }
    });

    expect(caught?.message).toBe('SPLIT_RATE_UNAVAILABLE');
    expect(h.rpcCalls.map((c) => c.fn)).toEqual(['sync_split_to_ledger']);
    expect(harness.result.current.syncing).toBe(false);
  });
});

/**
 * 逐筆排除同步。
 *
 * 勾選當下畫面就要變，寫入在背景依序排隊：不能讓使用者等上一筆處理完才能點下一筆。
 * 關掉由 RPC 在資料庫內原子刪除帳本那筆；重新勾選時群組若同步過，
 * 整批做完只同步一次把它們加回，從沒同步過的群組則只恢復預設。
 */
describe('useSplitSync.setExcluded', () => {
  let harness;
  let settled;
  let failed;

  const ITEMS = [
    { expense_id: 'exp-1', title: 'A', excluded: false },
    { expense_id: 'exp-2', title: 'B', excluded: false },
  ];

  async function setup(status) {
    h.statusResponse = { data: { ...status, items: ITEMS }, error: null };
    settled = vi.fn();
    failed = vi.fn();
    harness = renderSplitSync({ onExclusionsSettled: settled, onExclusionError: failed });
    await act(async () => { await harness.result.current.fetchSyncStatus(); });
    h.rpcCalls = [];
  }

  // 讓背景佇列跑完
  const flush = () => act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });

  const waitQuiet = () => act(() => { vi.advanceTimersByTime(EXCLUSION_SUMMARY_DELAY_MS); });

  beforeEach(() => {
    h.reset();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    harness?.unmount();
    harness = null;
    vi.useRealTimers();
  });

  it('取消勾選：畫面立即更新，背景呼叫 set_split_sync_excluded 後重抓狀態、不同步', async () => {
    await setup({ synced: true });
    h.setExcludedResponse = { data: { success: true, excluded: true, removed: 1 }, error: null };
    let release;
    h.holds.set_split_sync_excluded = new Promise((r) => { release = r; });

    act(() => harness.result.current.setExcluded('exp-1', true));
    // RPC 還沒回來，畫面已經是取消勾選
    expect(harness.result.current.syncItems[0].excluded).toBe(true);
    expect(harness.result.current.updatingExclusions).toBe(true);

    release();
    await flush();
    expect(h.rpcCalls.map((c) => c.fn)).toEqual(['set_split_sync_excluded', 'get_split_sync_status']);
    expect(h.rpcCalls[0].args).toEqual({ p_expense_id: 'exp-1', p_excluded: true });
    expect(harness.result.current.updatingExclusions).toBe(false);
    // 做完了但還沒停手夠久，不提示
    expect(settled).not.toHaveBeenCalled();
    await waitQuiet();
    expect(settled).toHaveBeenCalledWith({ removed: 1, ledgerUpdated: false });
  });

  it('重新勾選且群組同步過：移除排除紀錄後帶 p_time 同步一次', async () => {
    await setup({ synced: true });
    act(() => harness.result.current.setExcluded('exp-1', false));
    await flush();

    expect(h.rpcCalls.map((c) => c.fn)).toEqual([
      'set_split_sync_excluded',
      'sync_split_to_ledger',
      'get_split_sync_status',
    ]);
    expect(h.rpcCalls[1].args.p_time).toMatch(/^\d{2}:\d{2}$/);
    await waitQuiet();
    expect(settled).toHaveBeenCalledWith({ removed: 0, ledgerUpdated: true });
  });

  it('重新勾選但群組從沒同步過：只移除排除紀錄，不幫使用者同步', async () => {
    await setup({ synced: false, has_member: true });
    act(() => harness.result.current.setExcluded('exp-1', false));
    await flush();

    expect(h.rpcCalls.map((c) => c.fn)).toEqual(['set_split_sync_excluded', 'get_split_sync_status']);
    // 帳本沒有任何變動：勾選框本身就是回饋，不提示
    await waitQuiet();
    expect(settled).not.toHaveBeenCalled();
  });

  it('連點多筆不用等：依序送出、同一筆以最後一下為準，整批只同步一次', async () => {
    await setup({ synced: true });
    let release;
    h.holds.set_split_sync_excluded = new Promise((r) => { release = r; });

    act(() => {
      harness.result.current.setExcluded('exp-1', true);
      harness.result.current.setExcluded('exp-2', true);
      harness.result.current.setExcluded('exp-1', false); // 反悔
    });
    expect(harness.result.current.syncItems.map((i) => i.excluded)).toEqual([false, true]);

    release();
    await flush();
    const setCalls = h.rpcCalls.filter((c) => c.fn === 'set_split_sync_excluded').map((c) => c.args);
    expect(setCalls).toEqual([
      { p_expense_id: 'exp-1', p_excluded: false },
      { p_expense_id: 'exp-2', p_excluded: true },
    ]);
    expect(h.rpcCalls.filter((c) => c.fn === 'sync_split_to_ledger')).toHaveLength(1);
    await waitQuiet();
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('間隔著點好幾下：每下都處理完也不提示，停手後合併成一次', async () => {
    await setup({ synced: true });
    h.setExcludedResponse = { data: { success: true, excluded: true, removed: 1 }, error: null };

    for (const id of ['exp-1', 'exp-2']) {
      act(() => harness.result.current.setExcluded(id, true));
      await flush();
      // 停了一下但還不到門檻，又點下一筆
      act(() => { vi.advanceTimersByTime(EXCLUSION_SUMMARY_DELAY_MS - 500); });
      expect(settled).not.toHaveBeenCalled();
    }
    await waitQuiet();
    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith({ removed: 2, ledgerUpdated: false });
  });

  it('失敗時該筆退回伺服器狀態並回報錯誤，不同步', async () => {
    await setup({ synced: true });
    h.setExcludedResponse = { data: null, error: new Error('SPLIT_EXPENSE_NOT_FOUND') };
    act(() => harness.result.current.setExcluded('exp-1', false));
    await flush();

    expect(h.rpcCalls.map((c) => c.fn)).toEqual(['set_split_sync_excluded', 'get_split_sync_status']);
    expect(harness.result.current.syncItems[0].excluded).toBe(false); // 伺服器狀態
    // 失敗不等停手，立即回報；沒有成功的部分就不跳成功提示
    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed.mock.calls[0][0][0].message).toBe('SPLIT_EXPENSE_NOT_FOUND');
    await waitQuiet();
    expect(settled).not.toHaveBeenCalled();
  });

  it('手動同步進行中時勾選，寫入排在同步之後，不會兩邊同時動帳本', async () => {
    await setup({ synced: true });
    let release;
    h.holds.sync_split_to_ledger = new Promise((r) => { release = r; });

    let syncDone;
    act(() => { syncDone = harness.result.current.syncToLedger(); });
    act(() => harness.result.current.setExcluded('exp-1', true));
    await flush();
    expect(h.rpcCalls.map((c) => c.fn)).toEqual(['sync_split_to_ledger']);

    delete h.holds.sync_split_to_ledger;
    release();
    await act(async () => { await syncDone; });
    await flush();
    expect(h.rpcCalls.map((c) => c.fn)).toEqual([
      'sync_split_to_ledger',
      'get_split_sync_status',
      'set_split_sync_excluded',
      'get_split_sync_status',
    ]);
  });
});
