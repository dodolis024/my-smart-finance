import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

// React 18 的 act() 需要此旗標
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  ops: [], // 依序記錄寫入動作與通知，用來驗證「通知發生在資料寫完之後」
  reset() {
    this.ops = [];
  },
}));

vi.mock('@/lib/supabase', () => {
  const makeBuilder = (table) => {
    const b = {
      select: () => b,
      eq: () => b,
      order: async () => ({ data: [], error: null }),
      single: async () => ({ data: null, error: null }),
      update: () => { h.ops.push(`update:${table}`); return b; },
      insert: () => { h.ops.push(`insert:${table}`); return b; },
      delete: () => { h.ops.push(`delete:${table}`); return b; },
      upsert: () => { h.ops.push(`upsert:${table}`); return b; },
      // 各呼叫端 await 的終點形狀不同（{ error } / { data } / { count }），一次給齊
      then: (resolve) => resolve({ data: [], error: null, count: 0 }),
    };
    return b;
  };
  return { supabase: { from: (table) => makeBuilder(table) } };
});

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ lang: 'zh', t: (key) => key }),
}));

import { useSettings } from '@/hooks/useSettings';
import { clearAllCaches, setCached } from '@/lib/resourceCache';
import { subscribeDataChanged } from '@/lib/dataEvents';

const ACCOUNT = { id: 'acc-1', name: '玉山卡', type: 'credit_card', credit_limit: 50000 };

function renderSettings() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const result = { current: null };
  function Harness() {
    result.current = useSettings();
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

describe('useSettings 寫入後通知儀表板背景重抓', () => {
  let harness;
  let unsubscribe;

  beforeEach(() => {
    h.reset();
    clearAllCaches();
    setCached('settings', 'user-1', {
      expenseCategories: ['飲食', '交通', '其他'],
      incomeCategories: ['薪水'],
      accounts: [ACCOUNT],
    });
    unsubscribe = subscribeDataChanged(() => h.ops.push('notify'));
    harness = renderSettings();
  });

  afterEach(() => {
    unsubscribe?.();
    harness?.unmount();
    harness = null;
  });

  it('編輯帳戶（改額度）：存檔後發出通知', async () => {
    await act(async () => {
      await harness.result.current.saveAccount({ ...ACCOUNT, credit_limit: 80000 }, ACCOUNT.id);
    });

    expect(h.ops).toContain('update:accounts');
    expect(h.ops.at(-1)).toBe('notify'); // 通知在資料寫完之後
    expect(h.ops.filter((op) => op === 'notify')).toHaveLength(1);
  });

  it('新增帳戶：存檔後發出通知', async () => {
    await act(async () => {
      await harness.result.current.saveAccount({ name: '現金', type: 'cash' });
    });

    expect(h.ops).toContain('insert:accounts');
    expect(h.ops.at(-1)).toBe('notify');
  });

  it('刪除帳戶：刪除後發出通知', async () => {
    await act(async () => {
      await harness.result.current.deleteAccount(ACCOUNT.id);
    });

    expect(h.ops).toContain('delete:accounts');
    expect(h.ops.at(-1)).toBe('notify');
  });

  it('類別改名：等舊交易改寫完才通知（否則會重抓到改寫前的交易）', async () => {
    await act(async () => {
      await harness.result.current.renameCategory('expense', '飲食', '餐飲');
    });

    expect(h.ops).toEqual(['upsert:settings', 'update:transactions', 'notify']);
  });

  it('新增／排序類別：儀表板已由 settings 快取即時同步，不必多打一次重抓', async () => {
    await act(async () => {
      await harness.result.current.addCategory('expense', '寵物');
    });
    await act(async () => {
      await harness.result.current.reorderCategoriesTo('expense', ['其他', '飲食', '交通', '寵物']);
    });

    expect(h.ops).not.toContain('notify');
  });
});
