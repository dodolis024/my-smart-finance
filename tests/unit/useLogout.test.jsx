import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

// React 18 的 act() 需要此旗標
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  confirmResult: true,
  confirmMessages: [],
  signOutCalls: 0,
  reset() {
    this.confirmResult = true;
    this.confirmMessages = [];
    this.signOutCalls = 0;
  },
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-1' },
    signOut: async () => { h.signOutCalls += 1; },
  }),
}));

vi.mock('@/contexts/ConfirmContext', () => ({
  useConfirm: () => ({
    confirm: async (message) => {
      h.confirmMessages.push(message);
      return h.confirmResult;
    },
  }),
}));

// t 直接回傳 key + 參數，方便斷言用到哪一組文案與內插值
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
  }),
}));

import { useLogout } from '@/hooks/useLogout';
import { enqueueTransaction, listQueue } from '@/lib/offlineQueue';

const USER = 'user-1';

function makeTx(id) {
  return {
    id,
    date: '2026-09-04',
    type: 'expense',
    category: '飲食',
    item_name: '午餐',
    payment_method: '現金',
    currency: 'TWD',
    amount: 120,
    exchange_rate: 1,
    twd_amount: 120,
    note: null,
  };
}

// 掛載一個只呼叫 hook 的空元件，把 logout 函式取出來用
async function renderLogout() {
  const container = document.createElement('div');
  const root = createRoot(container);
  let logout;
  function Probe() {
    logout = useLogout();
    return null;
  }
  await act(async () => { root.render(createElement(Probe)); });
  return logout;
}

describe('useLogout', () => {
  beforeEach(() => {
    localStorage.clear();
    h.reset();
  });

  it('佇列是空的時候用一般登出提示', async () => {
    const logout = await renderLogout();
    await act(async () => { await logout(); });
    expect(h.confirmMessages).toEqual(['auth.logoutConfirm']);
    expect(h.signOutCalls).toBe(1);
  });

  it('有未同步交易時改用帶筆數的提示', async () => {
    enqueueTransaction(USER, makeTx('a'), '2026-09-04');
    enqueueTransaction(USER, makeTx('b'), '2026-09-04');
    const logout = await renderLogout();
    await act(async () => { await logout(); });
    expect(h.confirmMessages).toEqual(['auth.logoutConfirmPending:{"count":2}']);
    expect(h.signOutCalls).toBe(1);
  });

  it('使用者取消時不登出，佇列原封不動', async () => {
    enqueueTransaction(USER, makeTx('a'), '2026-09-04');
    h.confirmResult = false;
    const logout = await renderLogout();
    await act(async () => { await logout(); });
    expect(h.signOutCalls).toBe(0);
    expect(listQueue(USER)).toHaveLength(1);
  });
});
