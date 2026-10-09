import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// 匯率表由測試直接給，不連 Supabase（載入 lib/supabase 在 CI 會掛）
let mockTables = {};
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/hooks/useDisplayRates', () => ({
  useRateTables: () => mockTables,
  useDisplayRates: () => null,
}));

import PaymentStats from '@/components/dashboard/PaymentStats';
import { LanguageProvider } from '@/contexts/LanguageContext';

/**
 * 支付方式分析上的餘額：用帳戶自己的幣別顯示；需要換算卻還沒有匯率時先不顯示，
 * 不能拿台幣數字冒充英鎊。
 */

let container;
let root;

const wallet = {
  id: 'acc-gbp', accountName: '英鎊錢包', type: 'cash',
  balanceAmount: 100, balanceAsOf: '2026-09-06T14:00:00', balanceCurrency: 'GBP',
};

const gbpExpense = {
  id: 't1', type: 'expense', paymentMethod: '英鎊錢包', date: '2026-09-07', time: '12:00:00',
  currency: 'GBP', originalAmount: 5, exchangeRate: 41, twdAmount: 205,
};
const twdExpense = {
  id: 't2', type: 'expense', paymentMethod: '英鎊錢包', date: '2026-09-07', time: '13:00:00',
  currency: 'TWD', originalAmount: 410, exchangeRate: 1, twdAmount: 410,
};

function render(balanceHistory) {
  act(() => {
    root.render(
      createElement(LanguageProvider, null,
        createElement(PaymentStats, { history: balanceHistory, accounts: [wallet], balanceHistory, periodName: '9 月' })
      )
    );
  });
}

const balanceText = () => container.querySelector('.pay-balance')?.textContent ?? null;

beforeEach(() => {
  mockTables = {};
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('PaymentStats 餘額幣別', () => {
  it('英鎊錢包花 5 鎊：顯示 £95.00，不是扣掉 205', () => {
    render([gbpExpense]);
    expect(balanceText()).toMatch(/£\s?95\.00/);
  });

  it('混合幣別：台幣的帳依當天匯率換成英鎊再扣', () => {
    mockTables = { GBP: { history: [['2026-09-07', 41]], live: 41 } };
    render([gbpExpense, twdExpense]);
    // 100 − 5 − 410/41(=10)
    expect(balanceText()).toMatch(/£\s?85\.00/);
  });

  it('需要換算但匯率還沒到：先不顯示餘額', () => {
    render([gbpExpense, twdExpense]);
    expect(balanceText()).toBeNull();
  });
});
