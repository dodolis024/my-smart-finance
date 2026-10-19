import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

// React 18 的 act() 需要此旗標
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 刪除群組與移除成員都限群主（split_groups_delete / split_members_delete policy）。
 *
 * RLS 擋下時 PostgREST 回的是「成功、0 列」而不是錯誤，所以這裡守的是
 * 「沒真的刪到就要丟錯」——否則畫面會樂觀更新成已刪除的假象，重新整理才發現還在。
 */

const h = vi.hoisted(() => ({
  deletedRows: [],
  reset() { this.deletedRows = []; },
}));

vi.mock('@/lib/supabase', () => {
  const builder = () => {
    const chain = {
      select: async () => ({ data: h.deletedRows, error: null }),
      eq: () => chain,
      order: () => chain,
      then: (resolve) => resolve({ data: [], error: null }),
    };
    return chain;
  };
  return {
    supabase: {
      from: () => ({
        delete: () => builder(),
        update: () => builder(),
        select: () => builder(),
      }),
    },
  };
});

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k) => k }) }));
vi.mock('@/lib/splitNotify', () => ({ notifySplit: () => {} }));
vi.mock('@/hooks/useCachedResource', () => ({
  useCachedResource: () => ({ data: [], loading: false, load: async () => {}, setData: () => {} }),
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

describe('deleteGroup', () => {
  it('RLS 擋下（0 列）時丟錯，不假裝刪成功', async () => {
    h.deletedRows = [];
    const api = await renderHook();

    await expect(api.deleteGroup('group-1')).rejects.toThrow('SPLIT_DELETE_GROUP_DENIED');
  });

  it('真的刪到就正常完成', async () => {
    h.deletedRows = [{ id: 'group-1' }];
    const api = await renderHook();

    await expect(api.deleteGroup('group-1')).resolves.toBeUndefined();
  });
});

describe('removeMember', () => {
  it('RLS 擋下（0 列）時丟錯，不假裝移除成功', async () => {
    h.deletedRows = [];
    const api = await renderHook();

    await expect(api.removeMember('group-1', 'member-1')).rejects.toThrow('SPLIT_REMOVE_MEMBER_DENIED');
  });

  it('真的移除就正常完成', async () => {
    h.deletedRows = [{ id: 'member-1' }];
    const api = await renderHook();

    await expect(api.removeMember('group-1', 'member-1')).resolves.toBeUndefined();
  });
});

// split_members_update policy 只放行群主或本人：非群主改別人的名字時 RLS 同樣回「成功、0 列」
describe('updateMemberName', () => {
  it('RLS 擋下（0 列）時丟錯，不讓畫面顯示一個資料庫裡不存在的名字', async () => {
    h.deletedRows = [];
    const api = await renderHook();

    await expect(api.updateMemberName('group-1', 'member-1', '新名字')).rejects.toThrow('SPLIT_UPDATE_NAME_DENIED');
  });

  it('真的改到就正常完成', async () => {
    h.deletedRows = [{ id: 'member-1' }];
    const api = await renderHook();

    await expect(api.updateMemberName('group-1', 'member-1', '新名字')).resolves.toBeUndefined();
  });
});
