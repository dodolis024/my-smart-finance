import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import SplitExpenseItem from '@/components/split/SplitExpenseItem';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import { ConfirmProvider, useConfirm } from '@/contexts/ConfirmContext';
import { LanguageProvider } from '@/contexts/LanguageContext';

/**
 * 分帳備註的連結。分帳跟自己的帳本不一樣:備註是群組裡任何人寫的,
 * 所以連結不直接開,要先跳確認讓使用者看清楚要去哪個網站。
 * 確認鍵必須是真的 <a>——await 之後才 window.open 會被彈出視窗阻擋器攔掉。
 */

const members = [{ id: 'm1', name: '小明' }];
const expense = {
  id: 'e1',
  paid_by: 'm1',
  title: '晚餐',
  amount: 300,
  currency: 'TWD',
  date: '2026-09-08',
  note: '收據 https://drive.example.com/receipt/1',
  split_expense_shares: [{ id: 's1', member_id: 'm1', share: 300 }],
};

// ConfirmDialog 平常掛在 App 上,測試裡自己接一個一樣的
function Harness() {
  const { confirmState, handleConfirm, handleCancel } = useConfirm();
  return createElement(
    'div',
    null,
    createElement(SplitExpenseItem, { expense, members, onEdit: () => {}, onDelete: () => {} }),
    createElement(ConfirmDialog, { state: confirmState, onConfirm: handleConfirm, onCancel: handleCancel })
  );
}

let container;
let root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      createElement(LanguageProvider, null, createElement(ConfirmProvider, null, createElement(Harness)))
    );
  });
  // 備註在展開後才出現
  act(() => {
    container.querySelector('.split-expense-item').click();
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const noteLink = () => container.querySelector('.split-expense-item__note a');

describe('分帳備註的連結', () => {
  it('備註裡的網址會變成連結', () => {
    expect(noteLink()).not.toBeNull();
    expect(noteLink().getAttribute('href')).toBe('https://drive.example.com/receipt/1');
  });

  it('點下去不會直接開，而是先跳確認並顯示網域', () => {
    act(() => noteLink().click());

    const dialog = container.querySelector('.confirm-dialog__message');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('drive.example.com');
  });

  it('確認鍵是真的 <a>，不靠 window.open（會被彈出視窗阻擋）', () => {
    act(() => noteLink().click());

    const confirmBtn = container.querySelector('.confirm-dialog__btn--confirm');
    expect(confirmBtn.tagName).toBe('A');
    expect(confirmBtn.getAttribute('href')).toBe('https://drive.example.com/receipt/1');
    expect(confirmBtn.getAttribute('target')).toBe('_blank');
    expect(confirmBtn.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('按取消就什麼都不會開', () => {
    act(() => noteLink().click());
    act(() => container.querySelector('.confirm-dialog__btn').click());
    expect(container.querySelector('.confirm-dialog')).toBeNull();
  });

  it('點連結不會把費用列收合起來', () => {
    expect(container.querySelector('.split-expense-item__detail')).not.toBeNull();
    act(() => noteLink().click());
    expect(container.querySelector('.split-expense-item__detail')).not.toBeNull();
  });
});
