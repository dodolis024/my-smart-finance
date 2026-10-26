import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ result: { data: null, error: null }, queried: [] }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table) => ({
      select: (cols) => ({
        eq: (col, val) => {
          mocks.queried.push({ table, cols, col, val });
          return { maybeSingle: () => Promise.resolve(mocks.result) };
        },
      }),
    }),
  },
}));

import TransactionDetail from '@/components/transactions/TransactionDetail';
import { LanguageProvider } from '@/contexts/LanguageContext';

/**
 * 明細彈窗的「來自分帳」列：重新同步會保留使用者改過的分類與名稱，
 * 改過之後畫面上看不出這筆來自哪個分帳群組，所以在明細標出來源。
 */

const baseTx = {
  id: 'tx-1',
  date: '2026-09-20',
  time: '12:00:00',
  type: 'expense',
  itemName: 'Eurostar',
  category: '交通',
  currency: 'GBP',
  amount: 110,
  exchangeRate: 42.662116,
  twdAmount: 4692.83,
};

let container;
let root;

async function render(tx, isOpen = true) {
  await act(async () => {
    root.render(
      createElement(LanguageProvider, null,
        createElement(TransactionDetail, { transaction: tx, isOpen, onClose: () => {} })
      )
    );
  });
}

beforeEach(() => {
  mocks.result = { data: null, error: null };
  mocks.queried.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('明細彈窗的來自分帳', () => {
  it('分帳同步交易 → 顯示來源群組名稱', async () => {
    mocks.result = { data: { split_groups: { name: '🇬🇧' } }, error: null };
    await render(baseTx);

    expect(mocks.queried).toContainEqual(
      expect.objectContaining({ table: 'split_ledger_syncs', col: 'transaction_id', val: 'tx-1' })
    );
    expect(container.textContent).toContain('來自分帳');
    expect(container.textContent).toContain('🇬🇧');
  });

  it('一般交易 → 整列不出現', async () => {
    await render(baseTx);
    expect(container.textContent).not.toContain('來自分帳');
  });

  it('查詢失敗 → 整列不出現，明細照常顯示', async () => {
    mocks.result = { data: null, error: { message: 'network' } };
    await render(baseTx);
    expect(container.textContent).not.toContain('來自分帳');
    expect(container.textContent).toContain('Eurostar');
  });

  it('彈窗沒打開 → 不查詢', async () => {
    await render(baseTx, false);
    expect(mocks.queried).toHaveLength(0);
  });
});
