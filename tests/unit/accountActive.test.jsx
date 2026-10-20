import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 帳戶停用（剪卡、關戶）：歷史保留、不再出現在之後還會用到帳戶的地方。
 * 欄位不存在（migration 還沒跑、舊快取）一律視為啟用，加欄位前後行為相同。
 */

// 這些元件透過 lib/supabase 的 import 鏈會碰到環境變數，CI 沒有 .env.local
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/hooks/useDisplayRates', () => ({ useRateTables: () => ({}), useDisplayRates: () => null }));

import { isAccountActive, activeAccounts } from '@/lib/accountStatus';
import TransactionForm from '@/components/transactions/TransactionForm';
import AccountManager from '@/components/settings/AccountManager';
import PaymentStats from '@/components/dashboard/PaymentStats';
import { LanguageProvider } from '@/contexts/LanguageContext';

describe('isAccountActive', () => {
  it('駝峰（RPC）與蛇形（直接查表）都認得，缺欄位視為啟用', () => {
    expect(isAccountActive({ isActive: false })).toBe(false);
    expect(isAccountActive({ is_active: false })).toBe(false);
    expect(isAccountActive({ isActive: true })).toBe(true);
    expect(isAccountActive({ name: '舊快取裡的帳戶' })).toBe(true);
    expect(isAccountActive(null)).toBe(false);
    expect(activeAccounts([{ id: 1, isActive: false }, { id: 2 }]).map((a) => a.id)).toEqual([2]);
  });
});

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
});

const render = (el) => act(() => { root.render(createElement(LanguageProvider, null, el)); });
const $ = (sel) => container.querySelector(sel);
const $$ = (sel) => [...container.querySelectorAll(sel)];

const cash = { id: 'a1', accountName: '現金', type: 'cash', isActive: true };
const cutCard = { id: 'a2', accountName: '剪掉的卡', type: 'credit_card', isActive: false, overseasFeeRate: 1.5 };

describe('記帳表單的支付方式下拉', () => {
  const formProps = {
    categoriesExpense: ['飲食'], categoriesIncome: ['薪水'], accounts: [cash, cutCard],
    currencies: ['TWD', 'USD'], defaultCurrency: 'TWD', onSubmit: () => {}, onCancelEdit: () => {}, onCheckin: () => {},
  };
  const optionValues = () => $$('#method option').map((o) => o.value).filter(Boolean);

  it('新增時只列啟用中的帳戶', () => {
    render(createElement(TransactionForm, formProps));
    expect(optionValues()).toEqual(['現金']);
  });

  it('編輯停用卡的舊交易時，原值補成一個選項，存檔不會被迫換帳戶', () => {
    render(createElement(TransactionForm, {
      ...formProps,
      editingTransaction: {
        id: 't1', date: '2026-10-01', time: '09:00:00', itemName: '舊帳', category: '飲食', type: 'expense',
        paymentMethod: '剪掉的卡', currency: 'TWD', originalAmount: 100, exchangeRate: 1, twdAmount: 100,
      },
    }));
    expect(optionValues()).toEqual(['剪掉的卡', '現金']);
    expect($('#method').value).toBe('剪掉的卡');
  });
});

describe('支付工具管理', () => {
  const t = (zh) => $$('button').find((b) => b.textContent === zh);

  it('停用的帳戶另成「已停用」一區，按鈕變成啟用；啟用中的有停用鈕', async () => {
    const onSetActive = vi.fn(async () => {});
    render(createElement(AccountManager, {
      accounts: [
        { id: 'a1', name: '現金', type: 'cash', is_active: true },
        { id: 'a2', name: '剪掉的卡', type: 'credit_card', is_active: false },
      ],
      onSave: async () => {}, onDelete: async () => {}, onSetActive,
      onReorderTo: async () => {}, loading: false, confirm: async () => true, onError: () => {},
      currencies: ['TWD'], defaultCurrency: 'TWD',
    }));
    expect($('.accounts-inactive__title')).not.toBeNull();
    const inactiveNames = $$('.account-item--inactive .account-item__name').map((n) => n.textContent);
    expect(inactiveNames).toEqual(['剪掉的卡']);
    // 停用區沒有拖曳把手
    expect($('.account-item--inactive .account-item__drag-handle')).toBeNull();

    await act(async () => { t('啟用').click(); });
    expect(onSetActive).toHaveBeenCalledWith('a2', true);

    await act(async () => { t('停用').click(); });
    expect(onSetActive).toHaveBeenCalledWith('a1', false);
  });

  it('停用前會先確認，取消就不寫入；訂閱還在用時提示會帶數量', async () => {
    const onSetActive = vi.fn(async () => {});
    const confirm = vi.fn(async () => false);
    render(createElement(AccountManager, {
      accounts: [{ id: 'a1', name: '現金', type: 'cash' }],
      onSave: async () => {}, onDelete: async () => {}, onSetActive, confirm,
      countSubscriptionsUsing: async () => 2,
      onReorderTo: async () => {}, loading: false, onError: () => {},
      currencies: ['TWD'], defaultCurrency: 'TWD',
    }));
    await act(async () => { t('停用').click(); });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toContain('現金');
    expect(confirm.mock.calls[0][0]).toContain('2 個訂閱');
    expect(onSetActive).not.toHaveBeenCalled();
  });
});

describe('支付方式分析', () => {
  it('停用且本期沒交易的餘額帳戶不再硬列一行；有交易的照常統計', () => {
    const wallet = { id: 'w1', accountName: '舊錢包', type: 'cash', balanceAmount: 100, balanceAsOf: '2026-09-01T00:00:00', isActive: false };
    render(createElement(PaymentStats, { history: [], accounts: [wallet], balanceHistory: [], periodName: '10 月' }));
    expect($('.payment-stats-empty')).not.toBeNull();

    const tx = { id: 't1', type: 'expense', paymentMethod: '舊錢包', date: '2026-10-02', time: '12:00:00', currency: 'TWD', originalAmount: 50, exchangeRate: 1, twdAmount: 50 };
    render(createElement(PaymentStats, { history: [tx], accounts: [wallet], balanceHistory: [tx], periodName: '10 月' }));
    expect($$('.pay-name').map((n) => n.textContent)).toEqual(['舊錢包']);
    // 停用的帳戶不再顯示餘額
    expect($('.pay-balance')).toBeNull();
  });
});

describe('資料庫定義同步', () => {
  it('正式定義檔與 migration 的 get_dashboard_data 都回傳 isActive，schema 也有欄位', () => {
    const fn = readFileSync('database/supabase-functions.sql', 'utf8');
    const mig = readFileSync('database/account-active-migration.sql', 'utf8');
    const schema = readFileSync('database/supabase-migration.sql', 'utf8');
    expect(fn).toContain("'isActive', is_active");
    expect(mig).toContain("'isActive', is_active");
    expect(mig).toContain('ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE');
    expect(schema).toMatch(/is_active BOOLEAN NOT NULL DEFAULT TRUE/);
  });
});
