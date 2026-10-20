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
 * 明細彈窗的日期列附上記帳時間：資料庫存 HH:MM:SS，顯示到分；
 * time 欄位加入前的舊資料沒有時間，就只顯示日期，不能冒出「undefined」。
 */

const baseTx = {
  id: 1,
  date: '2026-09-21',
  type: 'expense',
  itemName: '一蘭拉麵',
  category: '飲食',
  currency: 'TWD',
  amount: 600,
  twdAmount: 600,
  paymentMethod: '現金',
};

let container;
let root;

function render(tx) {
  act(() => {
    root.render(
      createElement(LanguageProvider, null,
        createElement(TransactionDetail, { transaction: tx, isOpen: true, onClose: () => {} })
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

const dateValue = () => container.querySelector('.transaction-detail-value').textContent;

describe('明細彈窗的日期列', () => {
  it('有時間就顯示「日期 時:分」', () => {
    render({ ...baseTx, time: '08:05:00' });
    expect(dateValue()).toBe('2026-09-21 08:05');
  });

  it('舊資料沒有時間就只顯示日期', () => {
    render({ ...baseTx, time: null });
    expect(dateValue()).toBe('2026-09-21');
    render({ ...baseTx });
    expect(dateValue()).toBe('2026-09-21');
  });
});
