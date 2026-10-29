import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import Modal from '@/components/common/Modal';

/**
 * 彈窗疊彈窗（明細上再開交易詳情）時，Esc 只關最上面那層；
 * 之前每一層都各自聽 Esc，按一次兩層一起關。
 */

let container;
let root;

function render({ lowerOpen = true, upperOpen = true, onLower, onUpper }) {
  act(() => {
    root.render(createElement('div', null,
      createElement(Modal, { isOpen: lowerOpen, onClose: onLower }, createElement('div', null, 'list')),
      createElement(Modal, { isOpen: upperOpen, onClose: onUpper }, createElement('div', null, 'detail')),
    ));
  });
}

function press(key) {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
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

describe('疊起來的彈窗按 Esc', () => {
  it('只關最上面那層', () => {
    const onLower = vi.fn();
    const onUpper = vi.fn();
    render({ onLower, onUpper });

    press('Escape');

    expect(onUpper).toHaveBeenCalledTimes(1);
    expect(onLower).not.toHaveBeenCalled();
  });

  it('上層關掉後，再按 Esc 換關下面那層', () => {
    const onLower = vi.fn();
    const onUpper = vi.fn();
    render({ onLower, onUpper });
    render({ upperOpen: false, onLower, onUpper });

    press('Escape');

    expect(onLower).toHaveBeenCalledTimes(1);
    expect(onUpper).not.toHaveBeenCalled();
  });

  it('下層重繪（onClose 換成新的函式）不會跑到上層前面', () => {
    const onUpper = vi.fn();
    render({ onLower: vi.fn(), onUpper });
    const onLower = vi.fn();
    render({ onLower, onUpper });

    press('Escape');

    expect(onUpper).toHaveBeenCalledTimes(1);
    expect(onLower).not.toHaveBeenCalled();
  });
});
