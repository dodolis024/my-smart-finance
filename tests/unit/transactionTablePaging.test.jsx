import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act, useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * 交易紀錄分頁。
 *
 * 這裡守的是最容易寫錯的一件事：切片必須套在「表頭篩選之後」。
 * 若在上層先切片再傳進來，「篩選某分類 + 第 3 頁」就會出現空白頁。
 * 另外守 onVisibleCountChange 的語意——它回報的是篩選後的總數（上層用它算總頁數），
 * 不是當頁筆數；回報成當頁筆數會讓總頁數永遠是 1。
 */

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, lang: 'zh' }),
}));

// TransactionDetail 會載入 supabase（自查分帳同步狀態），測試環境不打真的網路
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => {
      const b = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => ({ data: null, error: null }),
        order: async () => ({ data: [], error: null }),
      };
      return b;
    },
  },
}));

const TransactionTable = (await import('@/components/transactions/TransactionTable')).default;

const PAGE_SIZE = 50;

// 120 筆：3 頁（50 / 50 / 20）。前 30 筆為「飲食」，其餘為「交通」
const makeRows = (n = 120) =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    date: '2026-09-01',
    time: '12:00:00',
    type: 'expense',
    category: i < 30 ? '飲食' : '交通',
    itemName: `項目${i}`,
    paymentMethod: '現金',
    currency: 'TWD',
    amount: 100,
    twdAmount: 100,
    note: null,
  }));

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

const dataRowCount = () => container.querySelectorAll('tbody tr[data-tx-id], tbody tr').length;
const itemTexts = () =>
  [...container.querySelectorAll('tbody tr')].map((tr) => tr.textContent);

function renderTable(props = {}) {
  act(() => {
    root.render(createElement(TransactionTable, { transactions: makeRows(), pageSize: PAGE_SIZE, ...props }));
  });
}

describe('TransactionTable 分頁', () => {
  it('第 1 頁顯示 50 筆、第 3 頁顯示剩下的 20 筆', () => {
    renderTable({ page: 1 });
    expect(dataRowCount()).toBe(50);
    expect(itemTexts()[0]).toContain('項目0');

    renderTable({ page: 3 });
    expect(dataRowCount()).toBe(20);
    expect(itemTexts()[0]).toContain('項目100');
    expect(itemTexts()[19]).toContain('項目119');
  });

  it('未指定 pageSize 時不分頁（維持原本一次列完的行為）', () => {
    renderTable({ pageSize: undefined });
    expect(dataRowCount()).toBe(120);
  });

  it('onVisibleCountChange 回報篩選後的總數，不是當頁筆數', () => {
    const counts = [];
    renderTable({ page: 1, onVisibleCountChange: (n) => counts.push(n) });
    expect(counts.at(-1)).toBe(120);

    // 套上分類篩選：只留「飲食」的 30 筆
    act(() => {
      container.querySelector('button[data-filter="category"]').click();
    });
    const box = [...container.querySelectorAll('.filter-popover__list input')]
      .find((el) => el.value === '飲食');
    act(() => {
      box.click();
    });

    expect(counts.at(-1)).toBe(30);
    expect(dataRowCount()).toBe(30); // 篩選後只有 30 筆，第 1 頁就放得下
  });

  it('切片套在篩選之後：篩選 + 第 2 頁不會變成空白頁', () => {
    // 120 筆全部符合篩選時第 2 頁有 50 筆；先切片再篩選的寫法這裡會拿到空陣列
    renderTable({ page: 2 });
    expect(dataRowCount()).toBe(50);
    expect(itemTexts()[0]).toContain('項目50');
  });

  it('使用者改表頭篩選時會通知上層（回第 1 頁用），掛載那次不通知', () => {
    const onFilterChange = vi.fn();
    renderTable({ page: 1, onFilterChange });
    expect(onFilterChange).not.toHaveBeenCalled();

    act(() => {
      container.querySelector('button[data-filter="category"]').click();
    });
    const box = [...container.querySelectorAll('.filter-popover__list input')]
      .find((el) => el.value === '飲食');
    act(() => {
      box.click();
    });

    expect(onFilterChange).toHaveBeenCalled();
  });
});

/** 重現 DashboardPage 的接線：頁碼在上層、總頁數由 onVisibleCountChange 算 */
function PagedTable({ transactions }) {
  const [visibleRowCount, setVisibleRowCount] = useState(0);
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(visibleRowCount / PAGE_SIZE));

  useEffect(() => {
    setPage((p) => (p > totalPages ? totalPages : p));
  }, [totalPages]);

  const resetPage = useCallback(() => setPage(1), []);

  return createElement('div', null,
    createElement('span', { className: 'pager-label' }, `${page} / ${totalPages}`),
    createElement('button', { className: 'pager-next', onClick: () => setPage((p) => p + 1) }, 'next'),
    createElement(TransactionTable, {
      transactions,
      page,
      pageSize: PAGE_SIZE,
      onVisibleCountChange: setVisibleRowCount,
      onFilterChange: resetPage,
    })
  );
}

describe('頁碼越界修正（上層接線）', () => {
  const label = () => container.querySelector('.pager-label').textContent;
  const next = () => act(() => { container.querySelector('.pager-next').click(); });

  it('筆數變少導致頁碼越界時，自動退到最後一頁而不是停在空白頁', () => {
    act(() => {
      root.render(createElement(PagedTable, { transactions: makeRows(120) }));
    });
    expect(label()).toBe('1 / 3');

    next();
    next();
    expect(label()).toBe('3 / 3');
    expect(dataRowCount()).toBe(20);

    // 例如刪掉交易後資料只剩 60 筆（2 頁）：第 3 頁已不存在
    act(() => {
      root.render(createElement(PagedTable, { transactions: makeRows(60) }));
    });
    expect(label()).toBe('2 / 2');
    expect(dataRowCount()).toBe(10);
  });

  it('改表頭篩選一律回第 1 頁（與越界修正不衝突）', () => {
    act(() => {
      root.render(createElement(PagedTable, { transactions: makeRows(120) }));
    });
    next();
    expect(label()).toBe('2 / 3');

    act(() => {
      container.querySelector('button[data-filter="category"]').click();
    });
    const box = [...container.querySelectorAll('.filter-popover__list input')]
      .find((el) => el.value === '交通');
    act(() => {
      box.click();
    });

    // 只剩「交通」的 90 筆 → 2 頁，且回到第 1 頁
    expect(label()).toBe('1 / 2');
    expect(dataRowCount()).toBe(50);
  });
});
