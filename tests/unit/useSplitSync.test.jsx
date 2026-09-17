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
  reset() {
    this.rpcCalls = [];
    this.syncResponse = { data: { success: true, created: 1 }, error: null };
    this.statusResponse = { data: { synced: true, needs_update: false }, error: null };
  },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: async (fn, args) => {
      h.rpcCalls.push({ fn, args });
      return fn === 'sync_split_to_ledger' ? h.syncResponse : h.statusResponse;
    },
  },
}));

import { useSplitSync } from '@/hooks/useSplitSync';

const GROUP_ID = 'group-1';

function renderSplitSync() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const result = { current: null };
  function Harness() {
    result.current = useSplitSync(GROUP_ID);
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
