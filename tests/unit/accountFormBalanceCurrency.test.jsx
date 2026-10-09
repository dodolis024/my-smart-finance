import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import AccountForm from '@/components/settings/AccountForm';
import { LanguageProvider } from '@/contexts/LanguageContext';

/**
 * 餘額的幣別：新帳戶預設跟記帳的預設幣別；台幣存 NULL（與舊帳戶一致）；
 * 換幣別等於換了一筆錢，設定時間要重蓋成現在。
 */

let container;
let root;
let onSave;

function render(account = null, props = {}) {
  act(() => {
    root.render(
      createElement(LanguageProvider, null,
        createElement(AccountForm, {
          account, onSave, onCancel: () => {}, loading: false,
          currencies: ['TWD', 'GBP', 'JPY'], defaultCurrency: 'GBP', ...props,
        })
      )
    );
  });
}

const $ = (sel) => container.querySelector(sel);
const amountInput = () => $('#account-balance-amount');
const currencySelect = () => $('.account-form__balance-currency');

function typeInto(el, value) {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
}

async function submit() {
  await act(async () => {
    container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  return onSave.mock.calls.at(-1)?.[0];
}

function fillNewCash() {
  render();
  typeInto($('input[type="text"]'), '錢包');
  typeInto($('select'), 'cash');
}

const OLD_AS_OF = '2026-09-01T10:00:00.000Z';
const existing = (over = {}) => ({
  id: 'acc-1', name: '錢包', type: 'cash', balance_amount: 100, balance_as_of: OLD_AS_OF, ...over,
});

beforeEach(() => {
  onSave = vi.fn().mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('AccountForm 餘額幣別', () => {
  it('新帳戶預設為記帳的預設幣別，存成該幣別', async () => {
    fillNewCash();
    expect(currencySelect().value).toBe('GBP');
    typeInto(amountInput(), '100');
    const payload = await submit();
    expect(payload.balance_amount).toBe(100);
    expect(payload.balance_currency).toBe('GBP');
  });

  it('選台幣存 NULL（與沒有幣別的舊帳戶一致）', async () => {
    fillNewCash();
    typeInto(amountInput(), '5000');
    typeInto(currencySelect(), 'TWD');
    const payload = await submit();
    expect(payload.balance_currency).toBeNull();
  });

  it('沒填餘額（不追蹤）時幣別也存 NULL', async () => {
    fillNewCash();
    const payload = await submit();
    expect(payload.balance_amount).toBeNull();
    expect(payload.balance_currency).toBeNull();
  });

  it('信用卡沒有餘額欄，也就沒有幣別選單', () => {
    render();
    typeInto($('select'), 'credit_card');
    expect(currencySelect()).toBeNull();
  });

  it('舊帳戶沒有幣別：顯示台幣，什麼都沒改就存，設定時間保留', async () => {
    render(existing());
    expect(currencySelect().value).toBe('TWD');
    const payload = await submit();
    expect(payload.balance_currency).toBeNull();
    expect(payload.balance_as_of).toBe(OLD_AS_OF);
  });

  it('只換幣別（金額不變）：設定時間重蓋成現在，從新幣別重新數起', async () => {
    render(existing());
    typeInto(currencySelect(), 'GBP');
    const payload = await submit();
    expect(payload.balance_currency).toBe('GBP');
    expect(payload.balance_as_of).not.toBe(OLD_AS_OF);
  });

  it('英鎊帳戶什麼都沒改就存：幣別與設定時間都保留', async () => {
    render(existing({ balance_currency: 'GBP' }));
    expect(currencySelect().value).toBe('GBP');
    const payload = await submit();
    expect(payload.balance_currency).toBe('GBP');
    expect(payload.balance_as_of).toBe(OLD_AS_OF);
  });

  it('帳戶的幣別不在清單裡（例如清單還沒載入）也照樣顯示，不會被換掉', () => {
    render(existing({ balance_currency: 'GBP' }), { currencies: ['TWD'] });
    expect(currencySelect().value).toBe('GBP');
  });
});
