import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * 同步明細的逐筆勾選與同步盒的排除提示。
 *
 * 守的是：
 * 1. 勾選狀態與 excluded 相反（勾 = 會同步），點下去回報「要不要納入」
 * 2. 勾選框永遠可以點：寫入在背景排隊，不能因為上一筆還在處理就鎖住整張表
 * 3. 合計用 currentTotal（排除後應有的金額），切換後馬上反映
 * 4. 從沒同步過的群組也要能打開明細：先排除再第一次同步，是「🇬🇧」群組的真實用法
 */

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key), lang: 'zh' }),
}));

// 沒有直接用到，但保險起見擋住：間接載入 supabase 會在 CI 缺環境變數時整個檔案掛掉
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

const SplitShareDetailModal = (await import('@/components/split/SplitShareDetailModal')).default;
const SplitSyncBox = (await import('@/components/split/SplitSyncBox')).default;

const ITEMS = [
  { expense_id: 'e1', title: '倫敦晚餐', date: '2026-09-01', share: 20, currency: 'GBP', excluded: false },
  { expense_id: 'e2', title: '台南民宿', date: '2026-04-01', share: 1500, currency: 'TWD', excluded: true },
];

let container;
let root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

function renderModal(props = {}) {
  const onToggle = vi.fn();
  act(() => {
    root.render(createElement(SplitShareDetailModal, {
      isOpen: true,
      onClose: () => {},
      items: ITEMS,
      groupName: '🇬🇧',
      currency: 'TWD',
      currentTotal: 800,
      onToggle,
      ...props,
    }));
  });
  return { onToggle };
}

const checks = () => [...container.querySelectorAll('input[type="checkbox"]')];
const rows = () => [...container.querySelectorAll('tbody tr')];

describe('SplitShareDetailModal', () => {
  it('每筆一個勾選框，放在最左欄，勾選狀態與 excluded 相反', () => {
    renderModal();
    expect(checks()).toHaveLength(2);
    expect(checks().map((c) => c.checked)).toEqual([true, false]);
    expect(rows().every((tr) => tr.firstElementChild.querySelector('input[type="checkbox"]'))).toBe(true);
    expect(checks()[0].getAttribute('aria-label')).toBe('split.syncItemToggle:{"title":"倫敦晚餐"}');
  });

  it('點「會同步」那列回報不納入；點「已排除」那列回報要納入', () => {
    const { onToggle } = renderModal();
    act(() => checks()[0].click());
    expect(onToggle).toHaveBeenLastCalledWith('e1', false);
    act(() => checks()[1].click());
    expect(onToggle).toHaveBeenLastCalledWith('e2', true);
  });

  it('勾選框不會被停用，連點兩筆都回報', () => {
    const { onToggle } = renderModal();
    expect(checks().some((c) => c.disabled)).toBe(false);
    act(() => checks()[0].click());
    act(() => checks()[1].click());
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it('被排除的列帶 --excluded 樣式', () => {
    renderModal();
    expect(rows()[0].className).not.toContain('split-share-detail__row--excluded');
    expect(rows()[1].className).toContain('split-share-detail__row--excluded');
  });

  it('合計顯示 currentTotal', () => {
    renderModal({ currentTotal: 12345 });
    expect(container.querySelector('.split-share-detail__total-amount').textContent).toBe('TWD 12,345');
  });

  it('沒有任何分攤時顯示空狀態，不畫表格', () => {
    renderModal({ items: [] });
    expect(container.querySelector('table')).toBeNull();
    expect(container.textContent).toContain('split.noShareRecords');
  });
});

describe('SplitSyncBox', () => {
  function renderBox(syncStatus) {
    const onViewDetail = vi.fn();
    act(() => {
      root.render(createElement(SplitSyncBox, {
        syncStatus,
        syncing: false,
        currency: 'TWD',
        fallbackAmount: 0,
        onSync: () => {},
        onViewDetail,
      }));
    });
    return { onViewDetail };
  }

  const viewDetailBtn = () =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'split.viewDetail');

  it('未同步狀態也有「查看明細」，點了開明細', () => {
    const { onViewDetail } = renderBox({ synced: false, has_member: true, current_total: 800, currency: 'TWD' });
    expect(viewDetailBtn()).toBeTruthy();
    act(() => viewDetailBtn().click());
    expect(onViewDetail).toHaveBeenCalledTimes(1);
  });

  it('excluded_count > 0 時各狀態都顯示排除筆數', () => {
    const states = [
      { synced: false, current_total: 800, currency: 'TWD', excluded_count: 5 },
      { synced: true, needs_update: true, synced_amount: 800, current_total: 900, currency: 'TWD', excluded_count: 5 },
      { synced: true, needs_update: false, synced_amount: 800, current_total: 800, currency: 'TWD', excluded_count: 5 },
    ];
    for (const s of states) {
      renderBox(s);
      expect(container.querySelector('.split-sync-box__excluded')?.textContent).toBe('split.excludedCount:{"n":5}');
    }
  });

  it('excluded_count 為 0 或沒有這個欄位（舊版資料庫）時不顯示', () => {
    renderBox({ synced: true, needs_update: false, synced_amount: 800, current_total: 800, currency: 'TWD', excluded_count: 0 });
    expect(container.querySelector('.split-sync-box__excluded')).toBeNull();
    renderBox({ synced: true, needs_update: false, synced_amount: 800, current_total: 800, currency: 'TWD' });
    expect(container.querySelector('.split-sync-box__excluded')).toBeNull();
  });
});
