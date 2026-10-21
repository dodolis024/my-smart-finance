import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 「離開群組」的入口：管理成員彈窗裡自己那一列。
 * 非群主才有（群主有自己的刪除群組流程）、要先確認、確認後才交給上層。
 */

const h = vi.hoisted(() => ({ confirmResult: true, confirmCalls: [] }));

vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({ select: () => Promise.resolve({ data: null }) }), rpc: () => Promise.resolve({ data: [], error: null }) } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u2' } }) }));
vi.mock('@/hooks/useSplitSync', () => ({ useSplitSync: () => ({ syncStatus: null, syncing: false, fetchSyncStatus: () => {}, syncToLedger: () => {} }) }));
vi.mock('@/hooks/useSplitExpenses', () => ({
  useSplitExpenses: () => ({
    expenses: [], settlements: [], loading: false,
    fetchExpenses: () => {}, addExpense: () => {}, updateExpense: () => {}, deleteExpense: () => {},
    addSettlement: () => {}, deleteSettlement: () => {}, calcSettlement: () => [],
  }),
}));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ success: () => {}, error: () => {} }) }));
vi.mock('@/contexts/ConfirmContext', () => ({
  useConfirm: () => ({
    confirm: (...args) => { h.confirmCalls.push(args); return Promise.resolve(h.confirmResult); },
  }),
}));

const { default: SplitGroupDetail } = await import('@/components/split/SplitGroupDetail');
const { LanguageProvider } = await import('@/contexts/LanguageContext');

// 目前登入的是 u2（非群主）；u1 是群主
const group = {
  id: 'g1', name: '日本旅行', owner_id: 'u1', currency: 'TWD', invite_code: 'ABCD',
  split_members: [
    { id: 'm1', name: '群主', user_id: 'u1' },
    { id: 'm2', name: '我', user_id: 'u2' },
    { id: 'm3', name: '小美', user_id: null },
  ],
};

let container;
let root;
let leaveCalls;

function render(g) {
  act(() => {
    root.render(createElement(LanguageProvider, null, createElement(SplitGroupDetail, {
      group: g,
      rates: { TWD: 1 },
      currencies: ['TWD'],
      onAddMember: () => {},
      onRemoveMember: () => {},
      onUpdateMemberName: () => {},
      onLeaveGroup: () => { leaveCalls++; },
      onUpdateGroup: () => {},
      onArchiveGroup: () => {},
      onUnarchiveGroup: () => {},
    })));
  });
  act(() => { container.querySelector('.split-group-detail__member-add-btn').click(); });
}

// 彈窗裡每一列的按鈕，以成員名稱分組
function buttonsByMember() {
  const rows = [...container.querySelectorAll('.split-modal__member-row--existing')];
  return Object.fromEntries(rows.map((row) => [
    row.querySelector('.split-modal__member-name')?.textContent,
    [...row.querySelectorAll('button')],
  ]));
}

beforeEach(() => {
  leaveCalls = 0;
  h.confirmResult = true;
  h.confirmCalls = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('離開群組', () => {
  it('非群主只在自己那列看得到離開鍵', () => {
    render(group);
    const buttons = buttonsByMember();

    expect(buttons['我']).toHaveLength(1);
    expect(buttons['群主']).toHaveLength(0);
    expect(buttons['小美']).toHaveLength(0);
  });

  it('確認後才交給上層', async () => {
    render(group);
    const [leaveBtn] = buttonsByMember()['我'];

    await act(async () => { leaveBtn.click(); });

    expect(h.confirmCalls).toHaveLength(1);
    expect(h.confirmCalls[0][0]).toContain('日本旅行');
    expect(leaveCalls).toBe(1);
  });

  it('取消確認就不離開', async () => {
    h.confirmResult = false;
    render(group);
    const [leaveBtn] = buttonsByMember()['我'];

    await act(async () => { leaveBtn.click(); });

    expect(leaveCalls).toBe(0);
  });

  it('群主看不到離開鍵', () => {
    render({ ...group, owner_id: 'u2' });
    const buttons = buttonsByMember();

    // 群主那列（現在是「我」）沒有離開鍵；未連結的小美只有群主才有的移除鍵
    expect(buttons['我']).toHaveLength(0);
    expect(container.querySelector('[aria-label="離開群組"], [aria-label="Leave group"]')).toBeNull();
  });
});
