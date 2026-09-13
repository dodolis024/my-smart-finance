import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import TransactionForm from '@/components/transactions/TransactionForm';
import { LanguageProvider } from '@/contexts/LanguageContext';

/**
 * 「海外消費」勾選框：只在選到有費率的卡時出現，外幣時依卡片設定自動勾，
 * 使用者親手點過就不再自動改；編輯時顯示這筆實際存的狀態。
 */

const ACCOUNTS = [
  { id: 'a1', accountName: '現金', type: 'cash' },
  { id: 'a2', accountName: '英國卡', type: 'credit_card', overseasFeeRate: 1.5, overseasFeeAutoCheck: true },
  { id: 'a3', accountName: '手動卡', type: 'debit_card', overseasFeeRate: 2, overseasFeeAutoCheck: false },
  { id: 'a4', accountName: '普通卡', type: 'credit_card', overseasFeeRate: null },
];

let container;
let root;
let onSubmit;

function render(props = {}) {
  act(() => {
    root.render(
      createElement(LanguageProvider, null,
        createElement(TransactionForm, {
          categoriesExpense: ['飲食'],
          categoriesIncome: ['薪水'],
          accounts: ACCOUNTS,
          currencies: ['TWD', 'GBP'],
          defaultCurrency: 'TWD',
          onSubmit,
          onCancelEdit: () => {},
          onCheckin: () => {},
          ...props,
        })
      )
    );
  });
}

const $ = (sel) => container.querySelector(sel);
const toggle = () => $('#overseas');

function change(selector, value) {
  const el = $(selector);
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function clickToggle() {
  act(() => {
    toggle().click();
  });
}

async function submit() {
  await act(async () => {
    $('#transactionForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  return onSubmit.mock.calls.at(-1)?.[0];
}

beforeEach(() => {
  onSubmit = vi.fn().mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('新增交易', () => {
  it('選現金或沒費率的卡不出現；選有費率的卡才出現；選收入分類消失', () => {
    render();
    expect(toggle()).toBeNull();

    change('#method', '現金');
    expect(toggle()).toBeNull();

    change('#method', '普通卡');
    expect(toggle()).toBeNull();

    change('#method', '英國卡');
    expect(toggle()).not.toBeNull();

    change('#category', 'income:薪水');
    expect(toggle()).toBeNull();

    change('#category', 'expense:飲食');
    expect(toggle()).not.toBeNull();
  });

  it('勾選框放在支付方式的標題列裡，不另外多一行', () => {
    render();
    change('#method', '英國卡');
    const row = toggle().closest('.form-group__label-row');
    expect(row).not.toBeNull();
    expect(row.querySelector('label[for="method"]')).not.toBeNull();
  });

  it('有費率＋外幣自動：台幣不勾，改成 GBP 自動勾，改回 TWD 取消', () => {
    render();
    change('#method', '英國卡');
    expect(toggle().checked).toBe(false);

    change('#currency', 'GBP');
    expect(toggle().checked).toBe(true);

    change('#currency', 'TWD');
    expect(toggle().checked).toBe(false);
  });

  it('先選 GBP 再選卡，也會自動勾', () => {
    render();
    change('#currency', 'GBP');
    change('#method', '英國卡');
    expect(toggle().checked).toBe(true);
  });

  it('帳戶較晚載入（冷啟動）：之後改幣別仍讀得到最新帳戶並自動勾', () => {
    render({ accounts: [] });
    render({ accounts: ACCOUNTS });
    change('#method', '英國卡');
    change('#currency', 'GBP');
    expect(toggle().checked).toBe(true);
  });

  it('外幣自動關閉的卡：選 GBP 也不勾，但勾選框仍出現', () => {
    render();
    change('#method', '手動卡');
    change('#currency', 'GBP');
    expect(toggle()).not.toBeNull();
    expect(toggle().checked).toBe(false);
  });

  it('使用者親手點過之後，改幣別不再自動變動', () => {
    render();
    change('#method', '英國卡');
    change('#currency', 'GBP');
    expect(toggle().checked).toBe(true);

    clickToggle();
    expect(toggle().checked).toBe(false);

    change('#currency', 'TWD');
    change('#currency', 'GBP');
    expect(toggle().checked).toBe(false);
  });

  it('送出時 onSubmit 收到正確的 overseas', async () => {
    render();
    change('#method', '英國卡');
    change('#currency', 'GBP');
    expect((await submit()).overseas).toBe(true);
  });

  it('勾選框隱藏時送出一律 false（親手勾過再換成現金）', async () => {
    render();
    change('#method', '英國卡');
    clickToggle();
    expect(toggle().checked).toBe(true);

    change('#method', '現金');
    expect(toggle()).toBeNull();
    expect((await submit()).overseas).toBe(false);
  });

  it('勾選框隱藏時送出一律 false（親手勾過再換成收入分類）', async () => {
    render();
    change('#method', '英國卡');
    clickToggle();
    change('#category', 'income:薪水');
    expect((await submit()).overseas).toBe(false);
  });

  it('送出後表單重設，下一筆重新依卡片預設', async () => {
    render();
    change('#method', '英國卡');
    clickToggle();
    await submit();

    change('#method', '英國卡');
    change('#currency', 'GBP');
    expect(toggle().checked).toBe(true);
  });
});

describe('編輯交易', () => {
  const overseasTx = {
    id: 'tx-1',
    date: '2026-09-01',
    time: '12:00:00',
    type: 'expense',
    itemName: '午餐',
    category: '飲食',
    paymentMethod: '英國卡',
    currency: 'GBP',
    originalAmount: 10,
    twdAmount: 426.66,
    overseasFeeRate: 1.5,
    overseasFee: 6.31,
  };

  it('原本是海外消費 → 載入即勾選', () => {
    render({ editingTransaction: overseasTx });
    expect(toggle().checked).toBe(true);
  });

  it('原本不是海外消費的外幣帳 → 載入時不勾（不套卡片預設）', () => {
    render({ editingTransaction: { ...overseasTx, twdAmount: 420.35, overseasFeeRate: null, overseasFee: null } });
    expect(toggle()).not.toBeNull();
    expect(toggle().checked).toBe(false);
  });

  it('資料表蛇形欄位（搜尋結果）也認得', () => {
    const { overseasFeeRate: _r, ...rest } = overseasTx;
    render({ editingTransaction: { ...rest, overseas_fee_rate: '1.500' } });
    expect(toggle().checked).toBe(true);
  });

  it('卡片費率後來被刪掉：原本是海外的帳仍顯示勾選框，取消勾選後消失', async () => {
    render({ editingTransaction: { ...overseasTx, paymentMethod: '普通卡' } });
    expect(toggle().checked).toBe(true);

    clickToggle();
    expect(toggle()).toBeNull();
    expect((await submit()).overseas).toBe(false);
  });

  it('分帳同步交易（paymentOptional）→ 不出現', () => {
    render({ editingTransaction: { ...overseasTx, overseasFeeRate: null }, paymentOptional: true });
    expect(toggle()).toBeNull();
  });
});
