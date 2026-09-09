import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 移除成員是「彈窗 → 群組內頁 → 分帳主頁 → Supabase」四層傳遞，
 * 中間任何一層多傳或少傳一個參數，最後都是刪不到人卻只跳一句「移除失敗」。
 * 這裡守的就是那條參數鏈：群組內頁交出去的必須是成員 id。
 */

vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({ select: () => Promise.resolve({ data: null }) }), rpc: () => Promise.resolve({ data: [], error: null }) } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/hooks/useSplitSync', () => ({ useSplitSync: () => ({ syncStatus: null, syncing: false, fetchSyncStatus: () => {}, syncToLedger: () => {} }) }));
vi.mock('@/hooks/useSplitExpenses', () => ({
  useSplitExpenses: () => ({
    expenses: [], settlements: [], loading: false,
    fetchExpenses: () => {}, addExpense: () => {}, updateExpense: () => {}, deleteExpense: () => {},
    addSettlement: () => {}, deleteSettlement: () => {}, calcSettlement: () => [],
  }),
}));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ success: () => {}, error: () => {} }) }));
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => ({ confirm: () => Promise.resolve(true) }) }));

const { default: SplitGroupDetail } = await import('@/components/split/SplitGroupDetail');
const { LanguageProvider } = await import('@/contexts/LanguageContext');

// u1 是群主才看得到移除鍵；小美沒有 user_id（未連結帳號）才可被移除
const group = {
  id: 'g1', name: '日本旅行', owner_id: 'u1', currency: 'TWD', invite_code: 'ABCD',
  split_members: [
    { id: 'm1', name: '我', user_id: 'u1' },
    { id: 'm2', name: '小美', user_id: null },
  ],
};

let container;
let root;
let removed;

beforeEach(() => {
  removed = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(createElement(LanguageProvider, null, createElement(SplitGroupDetail, {
      group,
      rates: { TWD: 1 },
      currencies: ['TWD'],
      onAddMember: () => {},
      onRemoveMember: (...args) => { removed.push(args); },
      onUpdateMemberName: () => {},
      onUpdateGroup: () => {},
      onArchiveGroup: () => {},
      onUnarchiveGroup: () => {},
    })));
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('移除成員', () => {
  it('交給上層的是成員 id，不是群組 id', async () => {
    act(() => { container.querySelector('.split-group-detail__member-add-btn').click(); });

    const removeBtn = container.querySelector('.split-modal__member-remove');
    expect(removeBtn, '群主應該看得到未連結成員的移除鍵').not.toBeNull();

    await act(async () => { removeBtn.click(); });

    expect(removed).toEqual([['m2']]);
  });
});
