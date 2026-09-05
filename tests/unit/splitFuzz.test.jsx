import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k) => k, lang: 'zh' }) }));
const AddExpenseModal = (await import('@/components/split/AddExpenseModal')).default;
const { calcSettlement } = await import('@/lib/splitSettlement');
const { shareDecimals, sumMatchesAmount } = await import('@/lib/splitShares');

let seed = 777;
const reseed = (v) => { seed = v; };
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)]; const int = (n) => Math.floor(rnd() * n);

let container, root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
const $ = (s) => container.querySelector(s);
const $$ = (s) => [...container.querySelectorAll(s)];
const click = (el) => el && act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const key = (k) => act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));
const type = (s) => { for (const c of s) key(c); };
function selectNative(el, value) {
  const set = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  act(() => { set.call(el, value); el.dispatchEvent(new Event('change', { bubbles: true })); });
}
function setNative(el, v) {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  act(() => { set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); });
}

const KEYS = ['0','1','2','3','5','7','9','.','+','-','*','/','Backspace','Enter','Escape'];

const ACTIONS = [
  // 亂敲金額欄
  () => { click($('#expense-amount')); for (let i = 0; i < 1 + int(6); i++) key(pick(KEYS)); },
  // 亂敲某個成員的分攤欄
  () => { const f = $$('.split-modal__participant-share'); if (f.length) { click(pick(f)); for (let i = 0; i < 1 + int(5); i++) key(pick(KEYS)); } },
  // 切換分攤模式
  () => click(pick($$('.split-modal__share-mode-btn'))),
  // 勾選/取消參與者
  () => click(pick($$('.split-modal__participant-check'))),
  // 中途換幣別
  () => { const sel = $('.split-modal__currency-select'); if (sel) selectNative(sel, pick(['TWD','USD','JPY','EUR'])); },
  // 換付款人
  () => { const sel = $('#expense-paidby'); const opts = sel ? [...sel.options].map(o => o.value) : []; if (opts.length) selectNative(sel, pick(opts)); },
  // 改名稱
  () => setNative($('#expense-title'), pick(['','晚餐','a','很長的名字'.repeat(3),'   '])),
  // 改日期
  () => setNative($('#expense-date'), pick(['2026-09-05','2020-01-01',''])),
  // 亂按鍵盤但沒開計算機
  () => key(pick(KEYS)),
];

describe('暴力亂搞：隨機操作後送出的資料必須永遠自洽', () => {
  it('300 回合隨機操作，只要送得出去就必須滿足所有不變條件', async () => {
    const violations = [];
    let submitted = 0, blocked = 0;

    for (let round = 0; round < 300; round++) {
      const memberCount = 1 + int(5);
      const members = Array.from({ length: memberCount }, (_, i) => ({ id: `m${i + 1}`, name: `成員${i + 1}` }));
      const groupCurrency = pick(['TWD', 'USD', 'JPY']);
      const onAdd = vi.fn().mockResolvedValue(undefined);

      act(() => {
        root.render(createElement(AddExpenseModal, {
          isOpen: true, onClose: () => {}, onAdd, onUpdate: vi.fn(),
          editingExpense: null, members, groupCurrency,
          currencies: ['TWD', 'USD', 'JPY', 'EUR'],
        }));
      });

      // 先建立一個有效狀態，再開始亂搞，否則大多數回合會被基本驗證擋掉而測不到東西
      setNative($('#expense-title'), '測試');
      click($('#expense-amount'));
      for (const k of pick([String(1+int(5000)), `${1+int(500)}.${int(100)}`, `${int(9)}.${int(9)}`]).split('')) key(k);
      key('Enter');
      for (let step = 0; step < 3 + int(7); step++) pick(ACTIONS)();
      // 亂搞可能把名稱或金額清掉，補回來讓它送得出去
      if (!$('#expense-title').value.trim()) setNative($('#expense-title'), '測試');
      if (!$('#expense-amount').value) {
        click($('#expense-amount'));
        for (const k of pick([String(1+int(5000)), `${1+int(500)}.${int(100)}`]).split('')) key(k);
        key('Enter');
      }

      const before = onAdd.mock.calls.length;
      await act(async () => { click($('.split-modal__actions button')); });
      if (onAdd.mock.calls.length === before) { blocked++; continue; }
      submitted++;

      const p = onAdd.mock.calls[0][0];
      const shown = $('#expense-amount')?.value;
      const decimals = shareDecimals(p.currency);
      const sum = p.shares.reduce((s, x) => s + x.share, 0);
      const bad = (msg) => violations.push({ round, msg, seenAmountField: shown, payload: JSON.stringify(p) });

      if (!Number.isFinite(p.amount) || p.amount <= 0) bad('金額不是正數');
      if (!p.shares.length) bad('沒有任何分攤');
      if (p.shares.some((s) => !Number.isFinite(s.share))) bad('分攤出現 NaN/Infinity');
      if (p.shares.some((s) => s.share < 0)) bad('分攤出現負數');
      if (!sumMatchesAmount(sum, p.amount)) bad(`分攤加總 ${sum} != 金額 ${p.amount}`);
      if (decimals === 0 && !Number.isInteger(p.amount)) bad('零小數幣別的金額不是整數');
      if (decimals === 0 && p.shares.some((s) => !Number.isInteger(s.share))) bad('零小數幣別的分攤不是整數');
      if (!p.paidBy) bad('沒有付款人');
      // 畫面上顯示的金額，與實際存下去的金額必須是同一個數字
      if (shown !== undefined && shown !== '' && Number(shown) !== p.amount) bad(`畫面顯示 ${shown} 但存入 ${p.amount}`);
    }

    console.log(`\n實際送出 ${submitted} 回合、被擋下 ${blocked} 回合`);
    if (violations.length) {
      console.log(`\n發現 ${violations.length} 個違規，前 8 筆：`);
      violations.slice(0, 8).forEach((v) => console.log(JSON.stringify(v)));
    }
    expect(violations).toEqual([]);
  }, 120000);
});

describe('所見即所存：自動分配的 placeholder 必須等於實際存入的金額', () => {
  it('150 回合自訂分攤，畫面提示的自動金額與寫入資料庫的金額必須一致', async () => {
    const bad = [];
    for (let round = 0; round < 150; round++) {
      const n = 2 + int(4);
      const members = Array.from({ length: n }, (_, i) => ({ id: `m${i + 1}`, name: `成員${i + 1}` }));
      const currency = pick(['TWD', 'USD', 'JPY']);
      const onAdd = vi.fn().mockResolvedValue(undefined);
      act(() => root.render(createElement(AddExpenseModal, {
        isOpen: true, onClose: () => {}, onAdd, onUpdate: vi.fn(), editingExpense: null,
        members, groupCurrency: currency, currencies: ['TWD', 'USD', 'JPY'],
      })));

      setNative($('#expense-title'), '測試');
      click($('#expense-amount')); type(pick([String(10 + int(2000)), `${10 + int(500)}.${int(100)}`])); key('Enter');
      click($$('.split-modal__share-mode-btn')[1]);

      // 隨機把一部分成員填上手動金額，其餘留給自動分配
      const fields = $$('.split-modal__participant-share');
      const manual = int(fields.length);
      for (let i = 0; i < manual; i++) { click(fields[i]); type(String(int(50))); key('Enter'); }

      // 記下畫面上「自動」欄位顯示的提示金額
      const placeholders = $$('.split-modal__participant-share')
        .map((el) => (el.value === '' ? el.placeholder : null));

      await act(async () => { click($('.split-modal__actions button')); });
      if (!onAdd.mock.calls.length) continue;

      const shares = onAdd.mock.calls[0][0].shares;
      placeholders.forEach((ph, i) => {
        if (ph == null) return;
        const saved = shares[i]?.share;
        if (saved !== undefined && Number(String(ph).replace(/,/g, '')) !== saved) {
          bad.push({ round, currency, placeholder: ph, saved });
        }
      });
    }
    if (bad.length) console.log('不一致：', JSON.stringify(bad.slice(0, 6)));
    expect(bad).toEqual([]);
  }, 120000);
});

describe('結算收斂：照建議付款後必須真的結清', () => {
  // 固定種子才能重現失敗，但只跑一組等於只測同樣的 400 筆——所以跑多組
  it.each([777, 20260905, 42, 987654321, 13])('種子 %i：照系統建議的金額付款後不可以再冒出待結算', (s) => {
    reseed(s);
    const notConverged = [];
    const shortChanged = [];
    for (let round = 0; round < 400; round++) {
      const n = 2 + int(5);
      const members = Array.from({ length: n }, (_, i) => ({ id: `m${i + 1}`, name: `成員${i + 1}` }));
      const settleCur = pick(['TWD', 'USD', 'JPY']);
      const rates = { TWD: 1, USD: 31.5, JPY: 0.21 };

      const expenses = Array.from({ length: 1 + int(5) }, () => {
        const cur = pick(['TWD', 'USD', 'JPY']);
        const amount = 1 + int(3000);
        const parts = members.filter(() => rnd() > 0.3);
        const list = parts.length ? parts : [members[0]];
        // 刻意用「不見得整除、也不見得對齊幣別」的分法，模擬各種來源的舊資料
        const base = Math.floor((amount / list.length) * 100) / 100;
        const shares = list.map((m, i) => ({
          member_id: m.id,
          share: i === 0 ? Number((amount - base * (list.length - 1)).toFixed(2)) : base,
        }));
        return { paid_by: pick(members).id, amount, currency: cur, split_expense_shares: shares };
      });

      const first = calcSettlement(members, expenses, [], rates, settleCur);
      const paid = first.map((t) => ({
        from_member: t.fromId, to_member: t.toId, amount: t.amount, currency: settleCur,
      }));
      const after = calcSettlement(members, expenses, paid, rates, settleCur);
      if (after.length) notConverged.push({ round, settleCur, first: first.length, after });

      // 代墊的人不該替別人吞零頭：少收的金額一定要小於一個面額
      const received = {};
      first.forEach((t) => { received[t.toId] = (received[t.toId] || 0) + t.amount; });
      const balances = {};
      members.forEach((m) => { balances[m.id] = 0; });
      expenses.forEach((e) => {
        const f = (rates[e.currency] ?? 1) / (rates[settleCur] ?? 1);
        balances[e.paid_by] += e.amount * f;
        e.split_expense_shares.forEach((s) => { balances[s.member_id] -= s.share * f; });
      });
      Object.entries(balances).forEach(([id, bal]) => {
        if (bal <= 0) return;
        const short = bal - (received[id] || 0);
        // 代墊的人不可以少收，一毛都不行——零頭一律由付款方往上吸收
        if (short > 1e-6) shortChanged.push({ round, settleCur, id, short });
      });
    }
    if (notConverged.length) console.log('未收斂：', JSON.stringify(notConverged.slice(0, 5)));
    if (shortChanged.length) console.log('代墊者少收滿一個面額：', JSON.stringify(shortChanged.slice(0, 5)));
    expect(notConverged).toEqual([]);
    expect(shortChanged).toEqual([]);
  }, 60000);
});
