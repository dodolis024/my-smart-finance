import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import AccountForm from '@/components/settings/AccountForm';
import { LanguageProvider } from '@/contexts/LanguageContext';
import zh from '@/locales/zh';

/**
 * 帳戶的海外手續費設定：只有信用卡與簽帳金融卡能設；填 0 等於沒設（存 NULL，資料庫 CHECK 要求 > 0）；
 * 類型改成不支援的時要清掉，不能殘留。
 */

let container;
let root;
let onSave;

function render(account = null) {
  act(() => {
    root.render(
      createElement(LanguageProvider, null,
        createElement(AccountForm, { account, onSave, onCancel: () => {}, loading: false })
      )
    );
  });
}

const $ = (sel) => container.querySelector(sel);
const feeInput = () => $('input[placeholder="1.5"]');
const autoCheck = () => $('.account-form__checkbox input[type="checkbox"]');

/** React 追蹤 input 的 value，要用原生 setter 才會觸發 onChange */
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

function fillNew(type, fee) {
  render();
  typeInto($('input[type="text"]'), '測試卡');
  typeInto($('select'), type);
  if (fee !== undefined) typeInto(feeInput(), fee);
}

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

describe('AccountForm 海外手續費', () => {
  it.each(['credit_card', 'debit_card'])('%s 出現費率欄', (type) => {
    fillNew(type);
    expect(feeInput()).not.toBeNull();
  });

  it.each(['cash', 'bank', 'digital_wallet'])('%s 不出現費率欄', (type) => {
    fillNew(type);
    expect(feeInput()).toBeNull();
  });

  it('費率 > 0 才出現「選外幣時自動勾選」，新卡預設開', () => {
    fillNew('credit_card');
    expect(autoCheck()).toBeNull();

    typeInto(feeInput(), '0');
    expect(autoCheck()).toBeNull();

    typeInto(feeInput(), '1.5');
    expect(autoCheck()).not.toBeNull();
    expect(autoCheck().checked).toBe(true);
  });

  it('填 1.5 → payload 帶費率與自動勾選', async () => {
    fillNew('credit_card', '1.5');
    expect(await submit()).toMatchObject({ overseas_fee_rate: 1.5, overseas_fee_auto_check: true });
  });

  it('關掉自動勾選 → payload 為 false', async () => {
    fillNew('debit_card', '2');
    act(() => autoCheck().click());
    expect(await submit()).toMatchObject({ overseas_fee_rate: 2, overseas_fee_auto_check: false });
  });

  it('填 0 → 存 null', async () => {
    fillNew('credit_card', '0');
    expect((await submit()).overseas_fee_rate).toBeNull();
  });

  it('留空 → 存 null', async () => {
    fillNew('credit_card');
    expect((await submit()).overseas_fee_rate).toBeNull();
  });

  it('填 11 → 顯示錯誤、不送出', async () => {
    fillNew('credit_card', '11');
    await submit();
    expect(onSave).not.toHaveBeenCalled();
    expect(container.textContent).toContain(zh.settings.account.overseasFeeRateError);
  });

  it('既有信用卡改成現金 → 費率清成 null，不殘留', async () => {
    render({
      id: 'acc-1',
      name: '英國卡',
      type: 'credit_card',
      overseas_fee_rate: '1.500',
      overseas_fee_auto_check: false,
    });
    expect(feeInput().value).toBe('1.5');
    expect(autoCheck().checked).toBe(false);

    typeInto($('select'), 'cash');
    expect(feeInput()).toBeNull();
    expect((await submit()).overseas_fee_rate).toBeNull();
  });

  it('編輯沒有手續費欄位的舊帳戶：自動勾選視為開', () => {
    render({ id: 'acc-2', name: '舊卡', type: 'credit_card' });
    expect(feeInput().value).toBe('');
    typeInto(feeInput(), '1.5');
    expect(autoCheck().checked).toBe(true);
  });
});
