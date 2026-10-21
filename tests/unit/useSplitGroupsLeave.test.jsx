import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 離開群組＝把自己那列的 user_id 設回 NULL（成員列與帳目都留著）。
 *
 * 守三件事：
 *   1) 送出去的是「自己那列、user_id: null」，不是刪列、也不是別人的列
 *   2) RLS 擋下（0 列）時要丟錯，不能樂觀地把群組從列表拿掉
 *   3) 成功後從列表移除並重抓
 */

const h = vi.hoisted(() => ({
  returnedRows: [],
  calls: [],
  loadCalls: 0,
  setDataCalls: [],
  reset() {
    this.returnedRows = [];
    this.calls = [];
    this.loadCalls = 0;
    this.setDataCalls = [];
  },
}));

const groups = [
  {
    id: 'group-1',
    name: '日本旅行',
    owner_id: 'owner-1',
    split_members: [
      { id: 'member-owner', name: '群主', user_id: 'owner-1' },
      { id: 'member-me', name: '我', user_id: 'user-1' },
      { id: 'member-empty', name: '小美', user_id: null },
    ],
  },
  { id: 'group-2', name: '別的群組', owner_id: 'owner-1', split_members: [] },
];

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table) => ({
      update: (values) => {
        const call = { table, values, filters: [] };
        h.calls.push(call);
        const chain = {
          eq: (col, val) => { call.filters.push([col, val]); return chain; },
          select: async () => ({ data: h.returnedRows, error: null }),
        };
        return chain;
      },
    }),
  },
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k) => k }) }));
vi.mock('@/lib/splitNotify', () => ({ notifySplit: () => {} }));
vi.mock('@/hooks/useCachedResource', () => ({
  useCachedResource: () => ({
    data: groups,
    loading: false,
    load: async () => { h.loadCalls++; },
    setData: (updater) => { h.setDataCalls.push(updater); },
  }),
}));

const { useSplitGroups } = await import('@/hooks/useSplitGroups');

async function renderHook() {
  const container = document.createElement('div');
  const root = createRoot(container);
  let api;
  function Probe() {
    api = useSplitGroups();
    return null;
  }
  await act(async () => { root.render(createElement(Probe)); });
  return api;
}

beforeEach(() => h.reset());

describe('leaveGroup', () => {
  it('只把自己那列的 user_id 設成 NULL', async () => {
    h.returnedRows = [{ id: 'member-me' }];
    const api = await renderHook();

    await api.leaveGroup('group-1');

    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].table).toBe('split_members');
    expect(h.calls[0].values).toEqual({ user_id: null });
    expect(h.calls[0].filters).toEqual([['id', 'member-me'], ['user_id', 'user-1']]);
  });

  it('成功後把群組從列表拿掉並重抓', async () => {
    h.returnedRows = [{ id: 'member-me' }];
    const api = await renderHook();

    await api.leaveGroup('group-1');

    expect(h.setDataCalls).toHaveLength(1);
    expect(h.setDataCalls[0](groups).map(g => g.id)).toEqual(['group-2']);
    expect(h.loadCalls).toBe(1);
  });

  it('RLS 擋下（0 列）時丟錯，群組留在列表裡', async () => {
    h.returnedRows = [];
    const api = await renderHook();

    await expect(api.leaveGroup('group-1')).rejects.toThrow('SPLIT_LEAVE_GROUP_DENIED');
    expect(h.setDataCalls).toHaveLength(0);
  });

  it('自己不在成員名單裡就不送出', async () => {
    const api = await renderHook();

    await expect(api.leaveGroup('group-2')).rejects.toThrow('SPLIT_LEAVE_GROUP_DENIED');
    expect(h.calls).toHaveLength(0);
  });
});
