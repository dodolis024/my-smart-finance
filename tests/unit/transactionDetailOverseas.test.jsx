import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// TransactionDetail 這條 import 鏈會拉到 @/lib/supabase,那支載入時就 createClient
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    }),
  },
}));

import TransactionDetail from '@/components/transactions/TransactionDetail';
import { LanguageProvider } from '@/contexts/LanguageContext';
import zh from '@/locales/zh';

/**
 * twd_amount 已含手續費。詳細頁把手續費併進「台幣合計」列（含手續費多少），
 * 沒有手續費的外幣交易列「台幣金額」；兩種情況匯率都以淺色字接在原幣金額後。
 */

const L = zh.transaction;

const gbpTx = {
  id: 1,
  date: '2026-09-08',
  type: 'expense',
  itemName: '午餐',
  category: '餐飲',
  paymentMethod: '英國卡',
  currency: 'GBP',
  originalAmount: 10,
  exchangeRate: 42.035,
  twdAmount: 426.66,
  overseasFeeRate: 1.5,
  overseasFee: 6.31,
  isSplitSynced: false,
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

/** 依畫面順序回傳 [標題, 值] */
function rows() {
  return [...container.querySelectorAll('.transaction-detail-item')].map((el) => [
    el.querySelector('.transaction-detail-label').textContent,
    el.querySelector('.transaction-detail-value').textContent,
  ]);
}

const valueOf = (label) => rows().find(([l]) => l === label)?.[1];
const labels = () => rows().map(([l]) => l);

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('明細彈窗的海外手續費', () => {
  it('外幣＋手續費：匯率接在原幣後，手續費併進台幣合計，不另列台幣金額', () => {
    render(gbpTx);

    expect(valueOf(L.amount)).toBe('GBP 10.00(匯率 42.0350)');
    expect(valueOf(L.twdTotal)).toBe('$427(含手續費 $6・1.5%)');
    expect(labels()).not.toContain(L.exchangeRate);
    expect(labels()).not.toContain(L.twdAmount);
    // 順序：金額 → 台幣合計 → 支付方式
    const order = labels();
    expect(order.indexOf(L.amount)).toBeLessThan(order.indexOf(L.twdTotal));
    expect(order.indexOf(L.twdTotal)).toBeLessThan(order.indexOf(L.paymentMethod));
  });

  it('資料表蛇形欄位（NUMERIC 字串）也能顯示', () => {
    render({ ...gbpTx, overseasFeeRate: undefined, overseasFee: undefined, overseas_fee_rate: '1.500', overseas_fee: '6.31' });

    expect(valueOf(L.twdTotal)).toBe('$427(含手續費 $6・1.5%)');
  });

  it('有手續費但沒有費率：只寫手續費金額', () => {
    render({ ...gbpTx, overseasFeeRate: null });

    expect(valueOf(L.twdTotal)).toBe('$427(含手續費 $6)');
  });

  it('台幣交易有手續費：金額後沒有匯率，台幣合計帶手續費', () => {
    render({ ...gbpTx, currency: 'TWD', originalAmount: 100, exchangeRate: 1, twdAmount: 101.5, overseasFee: 1.5 });

    expect(valueOf(L.amount)).not.toContain(L.exchangeRate);
    expect(labels()).not.toContain(L.twdAmount);
    expect(valueOf(L.twdTotal)).toBe('$102(含手續費 $2・1.5%)');
  });

  it('沒有手續費的外幣交易：原幣帶匯率，另列台幣金額', () => {
    render({ ...gbpTx, twdAmount: 420.35, overseasFeeRate: null, overseasFee: null });

    expect(valueOf(L.amount)).toBe('GBP 10.00(匯率 42.0350)');
    expect(labels()).not.toContain(L.twdTotal);
    expect(valueOf(L.twdAmount)).toBe('$420');
  });

  it('沒有手續費欄位的舊資料（undefined）不出現台幣合計', () => {
    const { overseasFeeRate: _r, overseasFee: _f, ...legacy } = gbpTx;
    render({ ...legacy, twdAmount: 420.35 });

    expect(labels()).not.toContain(L.twdTotal);
    expect(valueOf(L.twdAmount)).toBe('$420');
  });
});
