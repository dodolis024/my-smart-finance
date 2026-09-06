import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

// React 18 的 act() 需要此旗標
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  // 伺服器上 settings/streak_notices 那一列的 value，null 代表整列不存在
  remoteNotices: null,
  selectCalls: 0,
  upserts: [],
  selectError: null,
  reset() {
    this.remoteNotices = null;
    this.selectCalls = 0;
    this.upserts = [];
    this.selectError = null;
  },
}));

// useStreak 直接 import @/lib/supabase，載入時就會 createClient；
// CI 沒有 .env.local，少了這個 mock 整個檔案會在 import 階段就爆。
vi.mock('@/lib/supabase', () => {
  const settingsQuery = () => {
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => {
        h.selectCalls += 1;
        if (h.selectError) return { data: null, error: h.selectError };
        return { data: h.remoteNotices ? { value: h.remoteNotices } : null, error: null };
      },
    };
    return q;
  };
  return {
    supabase: {
      from: () => ({
        ...settingsQuery(),
        upsert: async (row) => {
          h.upserts.push(row);
          return { error: null };
        },
      }),
      rpc: async () => ({ data: null, error: null }),
      auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    },
  };
});

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
  }),
}));

import { useStreak } from '@/hooks/useStreak';

const USER = 'user-1';
const TODAY = new Date().toLocaleDateString('sv-SE');

function renderStreak() {
  const api = { current: null };
  function Probe() {
    api.current = useStreak(USER);
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(createElement(Probe)));
  return {
    api,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('連續紀錄提醒的每日去重（跨裝置）', () => {
  beforeEach(() => {
    h.reset();
    window.localStorage.clear();
  });

  it('本機與伺服器都沒記號時顯示一次，並把日期寫進兩邊', async () => {
    const { api, unmount } = renderStreak();

    let shown;
    await act(async () => {
      shown = await api.current.shouldShowBrokenModal(true);
    });

    expect(shown).toBe(true);
    expect(window.localStorage.getItem(`streakBrokenShownDate:${USER}`)).toBe(TODAY);
    expect(h.upserts.at(-1)).toMatchObject({
      user_id: USER,
      key: 'streak_notices',
      value: { broken: TODAY },
    });
    unmount();
  });

  it('另一台裝置今天已顯示過（伺服器有記號）就不再顯示', async () => {
    h.remoteNotices = { broken: TODAY };
    const { api, unmount } = renderStreak();

    let shown;
    await act(async () => {
      shown = await api.current.shouldShowBrokenModal(true);
    });

    expect(shown).toBe(false);
    // 記號要寫回本機，下次同一台裝置就不必再問伺服器
    expect(window.localStorage.getItem(`streakBrokenShownDate:${USER}`)).toBe(TODAY);
    expect(h.upserts).toHaveLength(0);
    unmount();
  });

  it('本機已有今天的記號時直接跳過，不打伺服器', async () => {
    window.localStorage.setItem(`streakBrokenShownDate:${USER}`, TODAY);
    const { api, unmount } = renderStreak();

    let shown;
    await act(async () => {
      shown = await api.current.shouldShowBrokenModal(true);
    });

    expect(shown).toBe(false);
    expect(h.selectCalls).toBe(0);
    unmount();
  });

  it('伺服器讀取失敗時退回本機判斷，仍然顯示', async () => {
    h.selectError = new Error('offline');
    const { api, unmount } = renderStreak();

    let shown;
    await act(async () => {
      shown = await api.current.shouldShowBrokenModal(true);
    });

    expect(shown).toBe(true);
    expect(window.localStorage.getItem(`streakBrokenShownDate:${USER}`)).toBe(TODAY);
    unmount();
  });

  it('伺服器記的是昨天（跨日）時要重新顯示', async () => {
    h.remoteNotices = { broken: '2000-01-01' };
    const { api, unmount } = renderStreak();

    let shown;
    await act(async () => {
      shown = await api.current.shouldShowBrokenModal(true);
    });

    expect(shown).toBe(true);
    unmount();
  });

  it('同一輪同時判斷兩個提醒只讀一次伺服器，且寫回時不互相覆蓋', async () => {
    const { api, unmount } = renderStreak();

    let results;
    await act(async () => {
      results = await Promise.all([
        api.current.shouldShowBrokenModal(true),
        api.current.shouldShowFreezeConsumedToast({ earnedTotal: 3, consumedThisCall: 1 }),
      ]);
    });

    expect(results).toEqual([true, true]);
    expect(h.selectCalls).toBe(1);
    // 後寫的那筆必須同時帶上兩個記號，否則另一台裝置會重跳被蓋掉的那個
    expect(h.upserts.at(-1).value).toEqual({ broken: TODAY, freezeConsumed: TODAY });
    unmount();
  });

  it('未消耗凍結卡時不會認領記號', async () => {
    const { api, unmount } = renderStreak();

    let shown;
    await act(async () => {
      shown = await api.current.shouldShowFreezeConsumedToast({ earnedTotal: 3, consumedThisCall: 0 });
    });

    expect(shown).toBe(false);
    expect(h.selectCalls).toBe(0);
    expect(h.upserts).toHaveLength(0);
    unmount();
  });
});
