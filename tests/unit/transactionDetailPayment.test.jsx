import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// LanguageContext 這條 import 鏈會拉到 @/lib/supabase,那支載入時就 createClient
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    }),
  },
}));

import TransactionDetail from '@/components/transactions/TransactionDetail';
import { LanguageProvider } from '@/contexts/LanguageContext';

/**
 * 明細彈窗的支付方式列:有填就顯示,沒填就整列不出現。
 * 分帳同步進來的交易以前一律隱藏,使用者補填了支付方式、列表看得到,點開明細卻看不到。
 */

const baseTx = {
  id: 1,
  date: '2026-09-21',
  time: '12:00:00',
  type: 'expense',
  itemName: '一蘭拉麵',
  category: '東京小旅行',
  currency: 'TWD',
  amount: 600,
  twdAmount: 600,
};

let container;
let root;

function render(tx) {
  act(() => {
    root.render(
      createElement(LanguageProvider, null,
        createElement(TransactionDetail, {
          transaction: tx, isOpen: true, onClose: () => {},
        })
      )
    );
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const values = () => [...container.querySelectorAll('.transaction-detail-value')].map((el) => el.textContent);

describe('明細彈窗的支付方式', () => {
  it('分帳同步交易補填了支付方式 → 照常顯示', () => {
    render({ ...baseTx, isSplitSynced: true, paymentMethod: '信用卡' });
    expect(values()).toContain('信用卡');
  });

  it('分帳同步交易沒填支付方式 → 整列不出現', () => {
    render({ ...baseTx, isSplitSynced: true, paymentMethod: '' });
    expect(container.textContent).not.toContain('支付方式');
  });

  it('一般交易有填支付方式 → 顯示', () => {
    render({ ...baseTx, isSplitSynced: false, paymentMethod: '現金' });
    expect(values()).toContain('現金');
  });
});
