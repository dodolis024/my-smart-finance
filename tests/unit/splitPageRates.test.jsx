import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 分帳頁的匯率（換算成群組結算幣別用）。
 *
 * 手機 PWA 常開好幾天，匯率不能停在開啟當天：
 * 1. 與主畫面共用 offlineCache 那份，一天內還新鮮就不重查
 * 2. 超過一天（或從沒存過）就重抓並存回去
 * 3. App 從背景切回前景時也要檢查，不必等重新整理
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 8, 17, 10, 0).getTime();

const db = vi.hoisted(() => ({ queries: 0, rows: [] }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => {
        db.queries += 1;
        return Promise.resolve({ data: db.rows, error: null });
      },
    }),
    rpc: () => Promise.resolve({ data: [], error: null }),
  },
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

vi.mock('@/hooks/useSplitGroups', () => ({
  useSplitGroups: () => ({
    groups: [{ id: 'g1', name: '日本旅行', currency: 'JPY', split_members: [] }],
    loading: false,
    fetchGroups: () => {},
    createGroup: () => {}, updateGroup: () => {}, archiveGroup: () => {}, unarchiveGroup: () => {},
    togglePin: () => {}, deleteGroup: () => {}, addMember: () => {}, updateMemberName: () => {}, removeMember: () => {},
  }),
}));

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ success: () => {}, error: () => {} }) }));
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => ({ confirm: () => Promise.resolve(true) }) }));

// 群組內頁換成替身，只把收到的匯率吐出來
const seen = { rates: null };
vi.mock('@/components/split/SplitGroupDetail', () => ({
  default: ({ rates }) => { seen.rates = rates; return null; },
}));

const { default: SplitPage } = await import('@/pages/SplitPage');
const { LanguageProvider } = await import('@/contexts/LanguageContext');

let container;
let root;

async function renderGroup() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(LanguageProvider, null,
        createElement(MemoryRouter, { initialEntries: ['/split/g1'] },
          createElement(Routes, null,
            createElement(Route, { path: '/split/:groupId', element: createElement(SplitPage) }),
          )
        )
      )
    );
  });
}

function storeRates(rates, savedAt) {
  localStorage.setItem('sf:rates:v1', JSON.stringify({ savedAt, rates }));
}

// jsdom 的 visibilityState 預設不是 'visible'，要自己裝成「回到前景」
async function comeBackToForeground() {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
}

beforeEach(() => {
  localStorage.clear();
  db.queries = 0;
  db.rows = [{ currency_code: 'JPY', rate: '0.22' }];
  seen.rates = null;
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('分帳頁的匯率', () => {
  it('一天內存過的匯率直接用，不重查', async () => {
    storeRates({ JPY: 0.21 }, NOW - 2 * 60 * 60 * 1000);
    await renderGroup();

    expect(db.queries).toBe(0);
    expect(seen.rates).toEqual({ TWD: 1, JPY: 0.21 });
  });

  it('超過一天就重抓，並存回共用快取', async () => {
    storeRates({ JPY: 0.21 }, NOW - DAY - 1);
    await renderGroup();

    expect(db.queries).toBe(1);
    expect(seen.rates).toEqual({ TWD: 1, JPY: 0.22 });
    expect(JSON.parse(localStorage.getItem('sf:rates:v1'))).toEqual({ savedAt: NOW, rates: { TWD: 1, JPY: 0.22 } });
  });

  it('從沒存過匯率時會抓', async () => {
    await renderGroup();
    expect(db.queries).toBe(1);
    expect(seen.rates).toEqual({ TWD: 1, JPY: 0.22 });
  });

  it('App 開著過了一天，切回前景就重抓', async () => {
    storeRates({ JPY: 0.21 }, NOW);
    await renderGroup();
    expect(db.queries).toBe(0);

    // 同一天內切回來：不查
    await comeBackToForeground();
    expect(db.queries).toBe(0);

    Date.now.mockReturnValue(NOW + DAY + 1);
    await comeBackToForeground();
    expect(db.queries).toBe(1);
    expect(seen.rates).toEqual({ TWD: 1, JPY: 0.22 });
  });

  it('查不到資料（離線）時沿用手上那份，不洗成只剩台幣', async () => {
    storeRates({ JPY: 0.21 }, NOW - DAY - 1);
    db.rows = null;
    await renderGroup();

    expect(db.queries).toBe(1);
    expect(seen.rates).toEqual({ TWD: 1, JPY: 0.21 });
  });
});
