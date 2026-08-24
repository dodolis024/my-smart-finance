import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

// React 18 的 act() 需要此旗標
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  upserts: [], // 收到的 settings upsert payload
  upsertError: null, // 設為物件即模擬存檔失敗
  reset() {
    this.upserts = [];
    this.upsertError = null;
  },
}));

vi.mock('@/lib/supabase', () => {
  const makeBuilder = () => {
    const b = {
      select: () => b,
      eq: () => b,
      order: async () => ({ data: [], error: null }),
      single: async () => ({ data: null, error: null }),
      upsert: (payload) => {
        h.upserts.push(payload);
        // saveCategoriesType 以 `await ...upsert(...)` 取 { error }
        return { then: (resolve) => resolve({ error: h.upsertError }) };
      },
    };
    return b;
  };
  return { supabase: { from: () => makeBuilder() } };
});

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ lang: 'zh', t: (key) => key }),
}));

import { useSettings } from '@/hooks/useSettings';
import { clearAllCaches, setCached } from '@/lib/resourceCache';

const SEED = ['飲食', '交通', '娛樂', '其他'];

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

describe('useSettings.reorderCategoriesTo', () => {
  let harness;

  beforeEach(() => {
    h.reset();
    clearAllCaches();
    // 預先 seed 快取，讓 hook 初始就有分類（useCachedResource 不會自動 load）
    setCached('settings', 'user-1', {
      expenseCategories: [...SEED],
      incomeCategories: ['薪水', '投資'],
      accounts: [],
    });
    harness = renderSettings();
  });

  afterEach(() => {
    harness?.unmount();
    harness = null;
  });

  it('重排相同集合：本地即時到位，並以新順序存檔一次', async () => {
    expect(harness.result.current.expenseCategories).toEqual(SEED);

    const newOrder = ['其他', '飲食', '娛樂', '交通'];
    await act(async () => {
      await harness.result.current.reorderCategoriesTo('expense', newOrder);
    });

    expect(harness.result.current.expenseCategories).toEqual(newOrder);
    expect(h.upserts).toHaveLength(1);
    expect(h.upserts[0].key).toBe('expense_categories');
    expect(h.upserts[0].value).toEqual(newOrder);
  });

  it('集合不同（含未知名稱）：直接忽略，不存檔也不改動', async () => {
    const bogus = ['飲食', '交通', '娛樂', '不存在的類別'];
    await act(async () => {
      await harness.result.current.reorderCategoriesTo('expense', bogus);
    });

    expect(harness.result.current.expenseCategories).toEqual(SEED); // 未變
    expect(h.upserts).toHaveLength(0); // 未觸發存檔
  });

  it('筆數不同：直接忽略，不存檔也不改動', async () => {
    const dropped = ['飲食', '交通', '娛樂']; // 少一個
    await act(async () => {
      await harness.result.current.reorderCategoriesTo('expense', dropped);
    });

    expect(harness.result.current.expenseCategories).toEqual(SEED);
    expect(h.upserts).toHaveLength(0);
  });

  it('存檔失敗：回滾為原順序並向外拋錯', async () => {
    h.upsertError = { message: 'save failed' };
    const newOrder = ['其他', '娛樂', '交通', '飲食'];

    let thrown = null;
    await act(async () => {
      try {
        await harness.result.current.reorderCategoriesTo('expense', newOrder);
      } catch (e) {
        thrown = e;
      }
    });

    expect(thrown).toEqual({ message: 'save failed' }); // 有向外拋
    expect(harness.result.current.expenseCategories).toEqual(SEED); // 已回滾
  });
});
