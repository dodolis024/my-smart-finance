import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * 支付方式下鑽。
 *
 * 守三件事：
 * 1. 每一種支付方式都點得下去，而且信用卡與非信用卡要分流到不同的彈窗
 * 2. 明細用的是統計自己算出來的那批交易 → 彈窗裡的金額必然與上方那一欄一致
 * 3. 信用卡彈窗的主角仍是額度管理：額度區塊永遠排在紀錄清單之前
 * 4. 換排序是「同一批資料重新排隊」：每列從舊位置滑到新位置，而不是整份閃掉重畫
 */

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, lang: 'zh' }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  },
}));

const PaymentStats = (await import('@/components/dashboard/PaymentStats')).default;
const CreditCardModal = (await import('@/components/common/CreditCardModal')).default;

const CARD = { id: 'a1', name: '玉山卡', type: 'credit_card', credit_limit: 100000, billing_day: 5, payment_due_day: 20 };
const CASH = { id: 'a2', name: '現金', type: 'cash' };

const HISTORY = [
  { id: 't1', date: '2026-09-01', itemName: '午餐', paymentMethod: '玉山卡', twdAmount: -300 },
  { id: 't2', date: '2026-09-02', itemName: '網購', paymentMethod: '玉山卡', twdAmount: -700 },
  { id: 't3', date: '2026-09-03', itemName: '飲料', paymentMethod: '現金', twdAmount: -60 },
  { id: 't4', date: '2026-09-04', itemName: '雜支', paymentMethod: '', twdAmount: -40 },
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

const rows = () => [...container.querySelectorAll('#paymentStats li')];
const rowByName = (name) => rows().find((li) => li.querySelector('.pay-name').textContent === name);

function renderStats(props = {}) {
  act(() => {
    root.render(createElement(PaymentStats, {
      history: HISTORY,
      accounts: [CARD, CASH],
      periodName: '這個月',
      ...props,
    }));
  });
}

describe('支付方式統計的點擊', () => {
  it('每一種支付方式都可以點，包含沒填支付方式的「未指定」', () => {
    renderStats({ onOpenCreditCard: vi.fn(), onSelectMethod: vi.fn() });
    expect(rows()).toHaveLength(3);
    rows().forEach((li) => {
      expect(li.classList.contains('clickable')).toBe(true);
      expect(li.getAttribute('role')).toBe('button');
    });
    expect(rowByName('transaction.unspecifiedPayment')).toBeTruthy();
  });

  it('非信用卡走一般明細彈窗，帶著自己的交易與占比分母', () => {
    const onSelectMethod = vi.fn();
    renderStats({ onOpenCreditCard: vi.fn(), onSelectMethod });

    act(() => { rowByName('現金').click(); });

    const payload = onSelectMethod.mock.calls[0][0];
    expect(payload.kind).toBe('payment');
    expect(payload.label).toBe('現金');
    expect(payload.value).toBe(-60);
    expect(payload.txs.map((tx) => tx.id)).toEqual(['t3']);
    // 分母是本期各支付方式的絕對值總和：1000 + 60 + 40
    expect(payload.totalExpense).toBe(1100);
  });

  it('信用卡走額度管理彈窗，並把本期紀錄一起交出去', () => {
    const onOpenCreditCard = vi.fn();
    renderStats({ onOpenCreditCard, onSelectMethod: vi.fn() });

    act(() => { rowByName('玉山卡').click(); });

    const [account, stat] = onOpenCreditCard.mock.calls[0];
    expect(account.id).toBe('a1');
    expect(stat.txs.map((tx) => tx.id)).toEqual(['t1', 't2']);
    // 清單加總 = 上方那一欄顯示的金額
    expect(stat.txs.reduce((s, tx) => s + tx.twdAmount, 0)).toBe(stat.value);
  });

  it('沒有 onSelectMethod 時非信用卡不會變成可點的死按鈕', () => {
    renderStats({ onOpenCreditCard: vi.fn() });
    expect(rowByName('現金').classList.contains('clickable')).toBe(false);
    expect(rowByName('玉山卡').classList.contains('clickable')).toBe(true);
  });
});

describe('信用卡彈窗的紀錄清單', () => {
  const renderModal = (props = {}) => act(() => {
    root.render(createElement(CreditCardModal, {
      isOpen: true,
      onClose: () => {},
      account: CARD,
      history: [],
      periodName: '這個月',
      ...props,
    }));
  });

  it('額度區塊永遠排在紀錄清單前面', () => {
    renderModal({ txs: HISTORY.slice(0, 2) });
    const limit = container.querySelector('.credit-limit-section');
    const records = container.querySelector('.credit-card-records');
    expect(limit).not.toBeNull();
    expect(records).not.toBeNull();
    // DOCUMENT_POSITION_FOLLOWING：records 在 limit 之後
    expect(limit.compareDocumentPosition(records) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelectorAll('.category-detail-row')).toHaveLength(2);
  });

  it('沒有傳 txs 時完全不長出紀錄區塊（額度版面維持原樣）', () => {
    renderModal();
    expect(container.querySelector('.credit-card-records')).toBeNull();
    expect(container.querySelector('.credit-limit-section')).not.toBeNull();
  });

  it('本期沒刷卡時顯示空清單提示，而不是空白', () => {
    renderModal({ txs: [] });
    expect(container.querySelector('.category-detail-modal__empty').textContent).toBe('creditCard.recordsEmpty');
    expect(container.querySelector('.category-detail-sort')).toBeNull();
  });
});

describe('換排序的位移動畫', () => {
  let origAnimate;
  let origRect;

  // 注意：全域的 Element 與 window.Element 在 vitest+jsdom 下不是同一個建構式，
  // 覆寫要動 window.Element.prototype，否則元件那邊讀到的還是原版
  beforeEach(() => {
    origAnimate = window.Element.prototype.animate;
    origRect = window.Element.prototype.getBoundingClientRect;
    // jsdom 沒有排版：讓每一列的 top 等於它在清單中的序位 × 50
    window.Element.prototype.getBoundingClientRect = function () {
      const idx = this.parentElement ? [...this.parentElement.children].indexOf(this) : 0;
      return { top: idx * 50, left: 0, right: 0, bottom: idx * 50 + 50, width: 0, height: 50, x: 0, y: idx * 50 };
    };
  });

  afterEach(() => {
    window.Element.prototype.animate = origAnimate;
    window.Element.prototype.getBoundingClientRect = origRect;
  });

  it('切到金額排序時，換了位置的列都從原本的位置滑過來', () => {
    const calls = [];
    window.Element.prototype.animate = function (frames) { calls.push({ el: this, frames }); return { finished: Promise.resolve() }; };

    act(() => {
      root.render(createElement(CreditCardModal, {
        isOpen: true, onClose: () => {}, account: CARD, history: [], periodName: '這個月',
        txs: HISTORY.slice(0, 3),
      }));
    });

    const sortBtns = [...container.querySelectorAll('.category-detail-sort__btn')];
    act(() => { sortBtns[1].click(); });

    // 日期序 t3,t2,t1 → 金額序 t2,t1,t3：三列的位置都變了
    expect(calls).toHaveLength(3);
    calls.forEach(({ el, frames }) => {
      expect(el.classList.contains('category-detail-row')).toBe(true);
      expect(frames[0].transform).toMatch(/^translateY\(-?\d+px\)$/);
      expect(frames[0].transform).not.toBe('translateY(0px)');
      expect(frames[1].transform).toBe('none');
    });
  });

  it('第一次開窗（沒有舊位置可比）不會硬做一次動畫', () => {
    const calls = [];
    window.Element.prototype.animate = function () { calls.push(1); return { finished: Promise.resolve() }; };

    act(() => {
      root.render(createElement(CreditCardModal, {
        isOpen: true, onClose: () => {}, account: CARD, history: [], periodName: '這個月',
        txs: HISTORY.slice(0, 3),
      }));
    });

    expect(calls).toHaveLength(0);
  });
});
