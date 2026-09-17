import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

// React 18 的 act() 需要此旗標
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 建立群組必須走 create_split_group RPC（單一交易）。
 *
 * 守的是「不要退回兩段 insert」：先建群組、再建成員的寫法在第二步失敗時會留下
 * 有群主沒成員的群組，群主看得到卻不能同步、也沒有把自己加回去的入口。
 */

const h = vi.hoisted(() => ({
  rpcCalls: [],
  rpcResponse: { data: null, error: null },
  loadCalls: 0,
  reset() {
    this.rpcCalls = [];
    this.rpcResponse = { data: null, error: null };
    this.loadCalls = 0;
  },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    // 建群組不該再碰 from()：一碰就代表退回了兩段寫入
    from: () => { throw new Error('createGroup 不應直接寫資料表'); },
    rpc: async (fn, args) => {
      h.rpcCalls.push({ fn, args });
      return h.rpcResponse;
    },
  },
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k) => k }) }));
vi.mock('@/lib/splitNotify', () => ({ notifySplit: () => {} }));
vi.mock('@/hooks/useCachedResource', () => ({
  useCachedResource: () => ({
    data: [],
    loading: false,
    load: async () => { h.loadCalls += 1; },
    setData: () => {},
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

describe('createGroup', () => {
  it('以單一 RPC 建立群組與成員，建立者排第一、空白成員名被濾掉', async () => {
    const group = { id: 'group-1', name: '日本行', owner_id: 'user-1' };
    h.rpcResponse = { data: group, error: null };
    const api = await renderHook();

    const result = await api.createGroup({
      name: '日本行',
      myName: 'Doris',
      currency: 'JPY',
      defaultExpenseCurrency: 'JPY',
      extraMembers: ['小明', '  ', '小華 '],
    });

    expect(h.rpcCalls).toEqual([
      {
        fn: 'create_split_group',
        args: {
          p_name: '日本行',
          p_my_name: 'Doris',
          p_currency: 'JPY',
          p_default_expense_currency: 'JPY',
          p_description: null,
          p_extra_members: ['小明', '小華'],
        },
      },
    ]);
    expect(result).toEqual(group);
    // 建完要重抓群組列表，畫面才會出現新群組
    expect(h.loadCalls).toBe(1);
  });

  it('RPC 失敗時原樣拋出（交易已 rollback，不會留下半套群組），且不重抓列表', async () => {
    h.rpcResponse = { data: null, error: new Error('SPLIT_NAME_REQUIRED') };
    const api = await renderHook();

    await expect(api.createGroup({ name: '', myName: 'Doris', extraMembers: [] }))
      .rejects.toThrow('SPLIT_NAME_REQUIRED');
    expect(h.loadCalls).toBe(0);
  });
});
