import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import ConfirmDialog from '@/components/common/ConfirmDialog';
import Modal from '@/components/common/Modal';
import { LanguageProvider } from '@/contexts/LanguageContext';

/**
 * 確認框按 Esc = 取消，而且只關最上層。
 * 確認框常疊在 Modal 上（設定裡刪除類別、明細裡刪除交易）；Esc 若被底下的 Modal 接走，
 * 會關錯視窗並留下一個按「確定」仍會執行刪除的確認框。
 */

let container;
let root;

function render({ state, onCancel, modalOpen = false, onModalClose = () => {} }) {
  act(() => {
    root.render(
      createElement(LanguageProvider, null,
        createElement(Modal, { isOpen: modalOpen, onClose: onModalClose },
          createElement('div', null, 'settings')
        ),
        createElement(ConfirmDialog, { state, onConfirm: () => {}, onCancel })
      )
    );
  });
}

function press(key) {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

const openState = { message: '確定要刪除嗎？', danger: true, href: null };

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('確認框的 Esc', () => {
  it('開著時按 Esc 會呼叫取消', () => {
    const onCancel = vi.fn();
    render({ state: openState, onCancel });

    press('Escape');

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('沒開時按 Esc 不會呼叫取消', () => {
    const onCancel = vi.fn();
    render({ state: null, onCancel });

    press('Escape');

    expect(onCancel).not.toHaveBeenCalled();
  });

  it('其他按鍵不會取消', () => {
    const onCancel = vi.fn();
    render({ state: openState, onCancel });

    press('Enter');
    press('a');

    expect(onCancel).not.toHaveBeenCalled();
  });

  it('疊在 Modal 上時，Esc 只關確認框，底下的 Modal 不動', () => {
    const onCancel = vi.fn();
    const onModalClose = vi.fn();
    render({ state: openState, onCancel, modalOpen: true, onModalClose });

    press('Escape');

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onModalClose).not.toHaveBeenCalled();
  });

  it('確認框關掉後，Esc 回到底下的 Modal', () => {
    const onCancel = vi.fn();
    const onModalClose = vi.fn();
    render({ state: openState, onCancel, modalOpen: true, onModalClose });
    render({ state: null, onCancel, modalOpen: true, onModalClose });

    press('Escape');

    expect(onCancel).not.toHaveBeenCalled();
    expect(onModalClose).toHaveBeenCalledTimes(1);
  });
});
