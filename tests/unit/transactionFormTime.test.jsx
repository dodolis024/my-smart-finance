import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import TransactionForm from '@/components/transactions/TransactionForm';
import { LanguageProvider } from '@/contexts/LanguageContext';

/**
 * 新增交易的日期時間：沒親手改過就代表「現在」。
 * 表單常開著很久（例如先去設定新增現金帳戶、設好餘額再回來記帳），時間若停在表單打開
 * 那一刻，這筆會落在錢包餘額的設定時間之前而不被扣款。
 */

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
          accounts: [{ id: 'a1', accountName: '現金', type: 'cash' }],
          currencies: ['TWD'],
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

// input 要走原生 setter，React 才認得出值有變
function setInputValue(selector, value) {
  const el = $(selector);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function setSelect(selector, value) {
  const el = $(selector);
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function fillRequired() {
  setInputValue('#item', '午餐');
  setSelect('#category', 'expense:飲食');
  setSelect('#method', '現金');
  setInputValue('#amount', '100');
}

async function submit() {
  await act(async () => {
    $('#transactionForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  return onSubmit.mock.calls.at(-1)?.[0];
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date(2026, 9, 9, 18, 12, 0));
  onSubmit = vi.fn().mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('新增交易的時間', () => {
  it('表單開著很久沒改時間：送出時用送出當下的時間', async () => {
    render();
    // 18:12 打開表單，去設定加帳戶，18:31 回來記帳
    vi.setSystemTime(new Date(2026, 9, 9, 18, 31, 20));
    fillRequired();
    const data = await submit();
    expect(data.date).toBe('2026-10-09');
    expect(data.time).toBe('18:31');
  });

  it('開著跨過午夜：日期也跟著換成今天', async () => {
    vi.setSystemTime(new Date(2026, 9, 9, 23, 58, 0));
    render();
    vi.setSystemTime(new Date(2026, 9, 10, 0, 5, 0));
    fillRequired();
    const data = await submit();
    expect(data.date).toBe('2026-10-10');
    expect(data.time).toBe('00:05');
  });

  it('畫面上的時間也會跟著走，看到的就是會存的', () => {
    render();
    expect($('#date').value).toBe('2026-10-09T18:12');
    act(() => {
      vi.setSystemTime(new Date(2026, 9, 9, 18, 31, 0));
      vi.advanceTimersByTime(15000);
    });
    expect($('#date').value).toBe('2026-10-09T18:31');
  });

  it('親手改過時間（補記舊帳）：照使用者填的存，畫面也不會被蓋掉', async () => {
    render();
    setInputValue('#date', '2026-10-01T08:30');
    act(() => {
      vi.setSystemTime(new Date(2026, 9, 9, 18, 40, 0));
      vi.advanceTimersByTime(15000);
    });
    expect($('#date').value).toBe('2026-10-01T08:30');
    fillRequired();
    const data = await submit();
    expect(data.date).toBe('2026-10-01');
    expect(data.time).toBe('08:30');
  });

  it('送出後重設：下一筆沒改時間就又回到跟著現在走', async () => {
    render();
    setInputValue('#date', '2026-10-01T08:30');
    fillRequired();
    await submit();
    vi.setSystemTime(new Date(2026, 9, 9, 19, 0, 0));
    fillRequired();
    const data = await submit();
    expect(data.date).toBe('2026-10-09');
    expect(data.time).toBe('19:00');
  });

  it('編輯舊交易：保留原本的時間，不會被換成現在', async () => {
    render({
      editingTransaction: {
        id: 't1', type: 'expense', date: '2026-09-01', time: '12:34:00', itemName: '舊帳',
        category: '飲食', paymentMethod: '現金', currency: 'TWD', twdAmount: 50,
      },
    });
    vi.setSystemTime(new Date(2026, 9, 9, 20, 0, 0));
    act(() => vi.advanceTimersByTime(15000));
    expect($('#date').value).toBe('2026-09-01T12:34');
    const data = await submit();
    expect(data.date).toBe('2026-09-01');
    expect(data.time).toBe('12:34');
  });
});
