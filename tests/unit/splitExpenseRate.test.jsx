import { describe, it, expect, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import SplitExpenseItem from '@/components/split/SplitExpenseItem';
import { ConfirmProvider } from '@/contexts/ConfirmContext';
import { LanguageProvider } from '@/contexts/LanguageContext';

/**
 * 分帳費用展開後的匯率列。
 * 規則比照個人帳本：台幣不顯示；查不到匯率（null）也不顯示，不能假裝成 1；
 * 舊費用的匯率是事後補上的，要註明「補記」，否則使用者會以為那是費用當天的匯率。
 */

const members = [{ id: 'm1', name: '小明' }];
const baseExpense = {
  id: 'e1',
  paid_by: 'm1',
  title: '晚餐',
  amount: 10000,
  currency: 'JPY',
  date: '2026-09-08',
  note: null,
  exchange_rate: 0.21,
  exchange_rate_estimated: false,
  split_expense_shares: [{ id: 's1', member_id: 'm1', share: 10000 }],
};

let container;
let root;

function renderExpanded(overrides) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      createElement(
        LanguageProvider,
        null,
        createElement(
          ConfirmProvider,
          null,
          createElement(SplitExpenseItem, {
            expense: { ...baseExpense, ...overrides },
            members,
            onEdit: () => {},
            onDelete: () => {},
          })
        )
      )
    );
  });
  act(() => {
    container.querySelector('.split-expense-item').click();
  });
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const rateRow = () => container.querySelector('.split-expense-item__rate');
const estimatedTag = () => container.querySelector('.split-expense-item__rate-estimated');

describe('分帳費用的匯率列', () => {
  it('外幣費用顯示凍結的匯率（四位小數，與個人帳本一致）', () => {
    renderExpanded();
    expect(rateRow()).not.toBeNull();
    expect(rateRow().textContent).toContain('匯率');
    expect(rateRow().textContent).toContain('0.2100');
    expect(estimatedTag()).toBeNull();
  });

  it('補記的匯率要註明', () => {
    renderExpanded({ exchange_rate_estimated: true });
    expect(estimatedTag()).not.toBeNull();
    expect(estimatedTag().textContent).toBe('補記');
  });

  it('台幣費用不顯示匯率', () => {
    renderExpanded({ currency: 'TWD', exchange_rate: 1 });
    expect(rateRow()).toBeNull();
  });

  it('查不到匯率（null）時不顯示，不能假裝成 1', () => {
    renderExpanded({ exchange_rate: null });
    expect(rateRow()).toBeNull();
  });
});
