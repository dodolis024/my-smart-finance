import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.localStorage = window.localStorage;

// TransactionTable 這條 import 鏈會拉到 @/lib/supabase，那支載入時就 createClient
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({}), rpc: async () => ({}) } }));

import TransactionTable from '@/components/transactions/TransactionTable';
import { LanguageProvider } from '@/contexts/LanguageContext';

const rows = [
  { id: 1, date: '2026-09-06', category: '餐飲', itemName: '午餐', paymentMethod: '現金', twdAmount: 120, type: 'expense' },
  { id: 2, date: '2026-09-06', category: '購物', itemName: '衛生紙', paymentMethod: '信用卡', twdAmount: 80, type: 'expense' },
  { id: 3, date: '2026-09-05', category: '薪資', itemName: '九月薪資', paymentMethod: '轉帳', twdAmount: 52000, type: 'income' },
  { id: 4, date: '2026-09-05', category: '餐飲', itemName: '晚餐', paymentMethod: '現金', twdAmount: 300, type: 'expense' },
];

let container;
let root;

function render(props = {}) {
  act(() => {
    root.render(
      createElement(LanguageProvider, null,
        createElement(TransactionTable, {
          transactions: rows, onEdit: () => {}, onDelete: () => {}, pageSize: 50, ...props,
        })
      )
    );
  });
}

const dayGroups = () => [...container.querySelectorAll('.tx-day')];
const txRows = () => [...container.querySelectorAll('tbody tr.transaction-row')];
const dateCells = () => txRows().map((tr) => tr.querySelector('.cell-date-inner')?.textContent ?? '');

describe('交易列表的每日分組', () => {
  beforeEach(() => {
    window.innerWidth = 1280;
    container = document.createElement('div');
    container.className = 'transaction-history-section';
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('每一天是一個獨立區塊，日期是卡片外的標題而不是表格列', () => {
    render({ groupByDate: true });

    expect(dayGroups()).toHaveLength(2);
    expect(txRows()).toHaveLength(4);
    // 日期由每日標題標示，交易列的日期欄要留白
    expect(dateCells()).toEqual(['', '', '', '']);
    // 標題不能是 tbody 裡的列，否則會沾到表格的底色與交錯底色
    expect(container.querySelectorAll('tbody .tx-day__head')).toHaveLength(0);
  });

  it('每日標題顯示筆數與收支合計，收入與支出分開列不相抵', () => {
    render({ groupByDate: true });

    const [d1, d2] = dayGroups().map((el) => el.querySelector('.tx-day__head').textContent);
    expect(d1).toContain('2026-09-06');
    expect(d1).toContain('2 筆');
    expect(d1).toContain('200');            // 120 + 80
    expect(d2).toContain('2 筆');
    expect(d2).toContain('52,000');         // 收入單獨列出
    expect(d2).toContain('300');            // 支出不與收入相抵
  });

  it('關掉分組（年檢視）時沒有每日標題，日期回到每一列', () => {
    render({ groupByDate: false });

    expect(dayGroups()).toHaveLength(0);
    expect(txRows()).toHaveLength(4);
    expect(dateCells()).toEqual(['2026-09-06', '2026-09-06', '2026-09-05', '2026-09-05']);
  });

  it('當日合計算在分頁前：同一天跨頁時兩頁顯示同一個總額', () => {
    render({ groupByDate: true, pageSize: 1, page: 2 });

    // 第 2 頁只有 09-06 的第二筆，標題仍要顯示當天完整的 2 筆 / 200
    expect(txRows()).toHaveLength(1);
    const head = dayGroups()[0].querySelector('.tx-day__head').textContent;
    expect(head).toContain('2 筆');
    expect(head).toContain('200');
  });
});
