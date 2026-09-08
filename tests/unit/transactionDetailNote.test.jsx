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

/**
 * 備註連結在明細彈窗裡真的被渲染成安全的 <a>。
 * 解析邏輯由 linkify.test.js 顧,這裡只顧「接線」與連結屬性:
 * 少了 target 會把使用者記到一半的頁面洗掉,少了 rel 會被開啟的網站導去釣魚頁。
 */

const baseTx = {
  id: 1,
  date: '2026-09-08',
  time: '12:00:00',
  type: 'expense',
  itemName: '午餐',
  category: '餐飲',
  paymentMethod: '現金',
  currency: 'TWD',
  amount: 120,
  twdAmount: 120,
  isSplitSynced: false,
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

const noteEl = () => container.querySelector('.transaction-detail-note');

describe('明細彈窗的備註連結', () => {
  it('網址被渲染成 <a>,而且帶齊 target 與 rel', () => {
    render({ ...baseTx, note: '收據 https://example.com/r/1 已存' });

    const link = noteEl().querySelector('a');
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('https://example.com/r/1');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).toBe('https://example.com/r/1');
  });

  it('連結前後的文字一字不漏', () => {
    render({ ...baseTx, note: '收據 https://example.com/r/1 已存' });
    expect(noteEl().textContent).toBe('收據 https://example.com/r/1 已存');
  });

  it('純文字備註不會冒出任何 <a>', () => {
    render({ ...baseTx, note: '午餐 便當' });
    expect(noteEl().querySelector('a')).toBeNull();
    expect(noteEl().textContent).toBe('午餐 便當');
  });

  it('javascript: 不會變成可點連結', () => {
    render({ ...baseTx, note: 'javascript:alert(1)' });
    expect(noteEl().querySelector('a')).toBeNull();
  });

  it('沒填備註時顯示未設定,不會渲染空連結', () => {
    render({ ...baseTx, note: '' });
    expect(noteEl().querySelector('a')).toBeNull();
    expect(noteEl().textContent.trim()).not.toBe('');
  });
});
