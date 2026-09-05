import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * 分帳彈窗的送出結果。
 *
 * 這裡守的是「費用金額」與「各人分攤加總」對不起來的那一類 bug：
 * split_expense_shares 沒有 CHECK 約束，這個元件是最後一道關卡，
 * 一旦放行就會在資料庫留下永遠對不平的帳。
 *
 * 特別針對計算機鍵盤還沒按確認就直接按儲存的路徑——金額欄這時放的是
 * 「50+50」這種算式字串，元件內部有兩處要讀它，讀法不一致就會出事。
 */

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, lang: 'zh' }),
}));

const AddExpenseModal = (await import('@/components/split/AddExpenseModal')).default;

const MEMBERS = [
  { id: 'm1', name: 'Doris' },
  { id: 'm2', name: '小明' },
  { id: 'm3', name: '小美' },
];

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
  vi.clearAllMocks();
});

function render(props = {}) {
  const onAdd = vi.fn().mockResolvedValue(undefined);
  act(() => {
    root.render(
      createElement(AddExpenseModal, {
        isOpen: true,
        onClose: () => {},
        onAdd,
        onUpdate: vi.fn(),
        editingExpense: null,
        members: MEMBERS,
        groupCurrency: 'TWD',
        ...props,
      })
    );
  });
  return onAdd;
}

const $ = (sel) => container.querySelector(sel);
const click = (el) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

function setTitle(value) {
  const input = $('#expense-title');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** 打開計算機並用實體鍵盤輸入，但「不按 Enter 確認」 */
function typeIntoKeypad(target, keys) {
  click(typeof target === 'string' ? $(target) : target);
  for (const key of keys) {
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    });
  }
}

const save = () => click($('.split-modal__actions button'));
const toCustomMode = () => click(container.querySelectorAll('.split-modal__share-mode-btn')[1]);
/** 自訂模式下第 i 位參與者的金額欄（依畫面順序，0 起算） */
const shareInput = (i) => container.querySelectorAll('.split-modal__participant-share')[i];
const errorText = () => $('.split-modal__error')?.textContent ?? null;
const sumOf = (shares) => Number(shares.reduce((s, x) => s + x.share, 0).toFixed(2));

describe('AddExpenseModal — 送出的分攤必須與費用金額相等', () => {
  it('均分模式：算式沒按確認就直接儲存，費用與分攤仍必須一致', async () => {
    const onAdd = render();
    setTitle('晚餐');
    typeIntoKeypad('#expense-amount', ['5', '0', '+', '5', '0']);
    await act(async () => { await save(); });

    expect(onAdd).toHaveBeenCalledTimes(1);
    const payload = onAdd.mock.calls[0][0];
    // 修正前：amount 存成 100，分攤卻只加總到 50，而且完全沒有錯誤訊息
    expect(payload.amount).toBe(100);
    expect(sumOf(payload.shares)).toBe(100);
    expect(errorText()).toBeNull();
  });

  it('均分模式：正常確認後的金額也要一致', async () => {
    const onAdd = render();
    setTitle('晚餐');
    typeIntoKeypad('#expense-amount', ['1', '0', '0', 'Enter']);
    await act(async () => { await save(); });

    const payload = onAdd.mock.calls[0][0];
    expect(payload.amount).toBe(100);
    expect(sumOf(payload.shares)).toBe(100);
  });

  it('台幣除不盡時分成整數，加總等於金額且最多差 1 元', async () => {
    const onAdd = render();
    setTitle('計程車');
    typeIntoKeypad('#expense-amount', ['1', '0', '0', 'Enter']);
    await act(async () => { await save(); });

    const shares = onAdd.mock.calls[0][0].shares.map((s) => s.share);
    expect(shares.every((v) => Number.isInteger(v))).toBe(true);
    expect(sumOf(onAdd.mock.calls[0][0].shares)).toBe(100);
    expect(Math.max(...shares) - Math.min(...shares)).toBe(1);
  });

  it('均分模式：算式除不盡時同樣要對得起來', async () => {
    const onAdd = render();
    setTitle('宵夜');
    // 1000/3 = 333.33，台幣再收成 333，分攤要加總回 333
    typeIntoKeypad('#expense-amount', ['1', '0', '0', '0', '/', '3']);
    await act(async () => { await save(); });

    const payload = onAdd.mock.calls[0][0];
    expect(payload.amount).toBe(333);
    expect(sumOf(payload.shares)).toBe(333);
  });

  it('台幣金額打了小數也會收成整數，不會卡在總和不符', async () => {
    const onAdd = render();
    setTitle('飲料');
    typeIntoKeypad('#expense-amount', ['1', '0', '0', '.', '5', 'Enter']);
    await act(async () => { await save(); });

    expect(errorText()).toBeNull();
    const payload = onAdd.mock.calls[0][0];
    expect(payload.amount).toBe(101);
    expect(sumOf(payload.shares)).toBe(101);
  });

  it('在外幣輸入小數後改成台幣，畫面與存入必須是同一個數字', async () => {
    // 抓到過的真實問題：畫面停在 100.5 卻存入 101
    const onAdd = render({ groupCurrency: 'USD', defaultExpenseCurrency: 'USD' });
    setTitle('晚餐');
    typeIntoKeypad('#expense-amount', ['1', '0', '0', '.', '5', 'Enter']);
    const select = $('.split-modal__currency-select');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    act(() => { setter.call(select, 'TWD'); select.dispatchEvent(new Event('change', { bubbles: true })); });
    // 存檔成功後表單會清空，所以要在送出前記下畫面上的數字
    const shown = $('#expense-amount').value;
    await act(async () => { await save(); });

    const payload = onAdd.mock.calls[0][0];
    expect(shown).toBe(String(payload.amount));
    expect(sumOf(payload.shares)).toBe(payload.amount);
  });

  it('外幣費用仍然分到分', async () => {
    const onAdd = render({ groupCurrency: 'USD', defaultExpenseCurrency: 'USD' });
    setTitle('Dinner');
    typeIntoKeypad('#expense-amount', ['1', '0', '0', 'Enter']);
    await act(async () => { await save(); });

    const shares = onAdd.mock.calls[0][0].shares.map((s) => s.share).sort((a, b) => a - b);
    expect(shares).toEqual([33.33, 33.33, 33.34]);
  });

  it('同一筆費用重開重算，零頭一定落在同一個人身上', async () => {
    const run = async () => {
      const onAdd = render();
      setTitle('晚餐');
      typeIntoKeypad('#expense-amount', ['1', '0', '0', 'Enter']);
      await act(async () => { await save(); });
      return onAdd.mock.calls[0][0].shares;
    };
    const first = await run();
    act(() => root.unmount());
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    expect(await run()).toEqual(first);
  });

  it('金額是 0 或空的時候不能送出', async () => {
    const onAdd = render();
    setTitle('晚餐');
    await act(async () => { await save(); });

    expect(onAdd).not.toHaveBeenCalled();
    expect(errorText()).toBe('split.addExpenseModal.invalidAmount');
  });

  it('金額超過資料庫上限要擋下，而不是丟出看不懂的資料庫錯誤', async () => {
    const onAdd = render();
    setTitle('買房');
    typeIntoKeypad('#expense-amount', ['9', '9', '9', '9', '9', '9', '9', '9', '9', '9', '9', 'Enter']);
    await act(async () => { await save(); });

    expect(onAdd).not.toHaveBeenCalled();
    expect(errorText()).toBe('split.addExpenseModal.amountTooLarge');
  });

  it('輸入負數算式會明確提示，不是把欄位默默清空', async () => {
    const onAdd = render();
    setTitle('晚餐');
    typeIntoKeypad('#expense-amount', ['1', '0', '0', 'Enter']);
    toCustomMode();
    typeIntoKeypad(shareInput(0), ['0', '-', '5', '0', '0', 'Enter']);

    expect(errorText()).toBe('split.addExpenseModal.invalidKeypadValue');
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('沒有名稱不能送出', async () => {
    const onAdd = render();
    typeIntoKeypad('#expense-amount', ['1', '0', '0', 'Enter']);
    await act(async () => { await save(); });

    expect(onAdd).not.toHaveBeenCalled();
    expect(errorText()).toBe('split.addExpenseModal.nameRequired');
  });
});

describe('AddExpenseModal — 自訂分攤', () => {
  it('手動填一個、其餘自動分配，加總必須等於金額', async () => {
    const onAdd = render();
    setTitle('聚餐');
    typeIntoKeypad('#expense-amount', ['1', '0', '0', 'Enter']);
    toCustomMode();
    typeIntoKeypad(shareInput(0), ['4', '0', 'Enter']);
    await act(async () => { await save(); });

    expect(onAdd).toHaveBeenCalledTimes(1);
    const payload = onAdd.mock.calls[0][0];
    expect(payload.amount).toBe(100);
    expect(sumOf(payload.shares)).toBe(100);
    expect(payload.shares.find((s) => s.member_id === 'm1').share).toBe(40);
  });

  it('分攤欄輸入算式沒按確認就儲存，加總仍必須等於金額', async () => {
    const onAdd = render();
    setTitle('聚餐');
    typeIntoKeypad('#expense-amount', ['1', '0', '0', 'Enter']);
    toCustomMode();
    // 修正前：剩餘金額用 parseFloat 讀成 20，自動分配算錯，按儲存會跳總和不符
    typeIntoKeypad(shareInput(0), ['2', '0', '+', '2', '0']);
    await act(async () => { await save(); });

    expect(errorText()).toBeNull();
    const payload = onAdd.mock.calls[0][0];
    expect(payload.shares.find((s) => s.member_id === 'm1').share).toBe(40);
    expect(sumOf(payload.shares)).toBe(100);
  });

  it('全部手動且加總差一分錢要擋下，不可以送出', async () => {
    const onAdd = render();
    setTitle('聚餐');
    typeIntoKeypad('#expense-amount', ['1', '0', '0', 'Enter']);
    toCustomMode();
    typeIntoKeypad(shareInput(0), ['3', '3', '.', '3', '3', 'Enter']);
    typeIntoKeypad(shareInput(1), ['3', '3', '.', '3', '3', 'Enter']);
    typeIntoKeypad(shareInput(2), ['3', '3', '.', '3', '3', 'Enter']);
    await act(async () => { await save(); });

    expect(onAdd).not.toHaveBeenCalled();
    expect(errorText()).toBe('split.addExpenseModal.sharesMismatch');
  });

  it('手動金額超過總額，導致別人分到負數時要擋下', async () => {
    const onAdd = render();
    setTitle('聚餐');
    typeIntoKeypad('#expense-amount', ['1', '0', '0', 'Enter']);
    toCustomMode();
    typeIntoKeypad(shareInput(0), ['5', '0', '0', 'Enter']);
    await act(async () => { await save(); });

    expect(onAdd).not.toHaveBeenCalled();
    expect(errorText()).toBe('split.addExpenseModal.customNegative');
  });
});

describe('AddExpenseModal — 編輯既有費用', () => {
  const expenseWith = (shares) => ({
    id: 'e1', title: '晚餐', amount: 100, currency: 'TWD', date: '2026-09-01',
    note: '', paid_by: 'm1', split_expense_shares: shares,
  });

  it('均分的費用要載入成均分模式', () => {
    render({ editingExpense: expenseWith([
      { member_id: 'm1', share: 33.34 },
      { member_id: 'm2', share: 33.33 },
      { member_id: 'm3', share: 33.33 },
    ]) });

    const [equalBtn] = container.querySelectorAll('.split-modal__share-mode-btn');
    expect(equalBtn.className).toContain('is-active');
  });

  it('舊的台幣自訂分攤（帶小數）只改標題也要存得回去', async () => {
    // 改制前台幣可以存小數；直接載入會過不了總和檢查，
    // 使用者連改個標題都存不了，畫面上也看不出該改哪裡
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    act(() => {
      root.render(createElement(AddExpenseModal, {
        isOpen: true, onClose: () => {}, onAdd: vi.fn(), onUpdate, members: MEMBERS, groupCurrency: 'TWD',
        editingExpense: expenseWith([
          { member_id: 'm1', share: 50.5 },
          { member_id: 'm2', share: 30 },
          { member_id: 'm3', share: 19.5 },
        ]),
      }));
    });
    setTitle('晚餐（改名）');
    await act(async () => { await save(); });

    expect(onUpdate).toHaveBeenCalled();
    const shares = onUpdate.mock.calls[0][1].shares;
    expect(shares.every((s) => Number.isInteger(s.share))).toBe(true);
    expect(shares.reduce((sum, s) => sum + s.share, 0)).toBe(100);
  });

  it('喬過金額的費用要載入成自訂模式，不可以被自動重算沖掉', () => {
    render({ editingExpense: expenseWith([
      { member_id: 'm1', share: 50 },
      { member_id: 'm2', share: 30 },
      { member_id: 'm3', share: 20 },
    ]) });

    const customBtn = container.querySelectorAll('.split-modal__share-mode-btn')[1];
    expect(customBtn.className).toContain('is-active');
  });
});
