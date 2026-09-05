import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { useSwipe } from '@/hooks/useSwipe';
import { SWIPE } from '@/lib/constants';

// React 18 的 act() 需要此旗標
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SWIPE_TRANSITION = 'transform 300ms cubic-bezier(0.4, 0, 0.2, 1)';

let api = null;
let container = null;
let root = null;

/** jsdom 沒有 TouchEvent，直接餵 handler 需要的最小事件形狀 */
function touchEvent(clientX, clientY = 0) {
  return {
    touches: [{ clientX, clientY }],
    target: { closest: () => null },
    preventDefault: () => {},
    stopPropagation: () => {},
  };
}

function Probe(options) {
  api = useSwipe({ isMobile: true, ...options });
  return null;
}

function render(options = {}) {
  act(() => {
    root = createRoot(container);
    root.render(createElement(Probe, options));
  });
}

/** 依序送出 touchstart → 數個 touchmove，座標可寫成 x 或 [x, y] */
function drag(from, ...points) {
  const at = (p) => (Array.isArray(p) ? touchEvent(p[0], p[1]) : touchEvent(p));
  act(() => api.handleTouchStart(at(from)));
  for (const p of points) {
    act(() => api.handleTouchMove(at(p)));
  }
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  // 滑開的列會被記進模組層單例，收乾淨才不會污染下一個測試
  if (api) act(() => api.resetSwipe());
  act(() => root?.unmount());
  container?.remove();
  api = null;
  root = null;
});

describe('useSwipe', () => {
  it('拖曳中關掉 transition，放手才接回動畫', () => {
    render();
    expect(api.swipeTransition).toBe(SWIPE_TRANSITION);

    drag(200, 180);
    // 拖曳中若留著 transition，手指的微幅抖動會不斷重啟補間動畫，整列看起來在閃
    expect(api.swipeTransition).toBe('none');
    expect(api.translateX).toBe(-20);

    act(() => api.handleTouchEnd(touchEvent(180)));
    expect(api.swipeTransition).toBe(SWIPE_TRANSITION);
  });

  it('位移永遠是整數像素', () => {
    render();
    drag(200.6, 180.15);
    expect(Number.isInteger(api.translateX)).toBe(true);
  });

  it('超過門檻放手停在動作按鈕寬度，未過門檻彈回原位', () => {
    render();
    drag(200, 120);
    act(() => api.handleTouchEnd(touchEvent(120)));
    expect(api.translateX).toBe(-SWIPE.ACTION_WIDTH);

    act(() => api.resetSwipe());
    drag(200, 180);
    act(() => api.handleTouchEnd(touchEvent(180)));
    expect(api.translateX).toBe(0);
  });

  it('垂直滑動不帶動位移，讓頁面正常捲動', () => {
    render();
    drag([200, 300], [200, 300], [196, 260]);
    expect(api.translateX).toBe(0);
    expect(api.swipeTransition).toBe(SWIPE_TRANSITION);
  });

  it('touchcancel 也會收尾，不會卡在半開', () => {
    render();
    drag(200, 170);
    expect(api.translateX).toBe(-30);

    // iOS 長按叫出系統選單時只有 touchcancel，沒有 touchend
    act(() => api.handleTouchCancel());
    expect(api.translateX).toBe(0);
    expect(api.swipeTransition).toBe(SWIPE_TRANSITION);
  });

  it('沒有移動的輕點會開詳情，已滑開的列輕點則不會', () => {
    const onClick = vi.fn();
    render({ onClick });

    act(() => api.handleTouchStart(touchEvent(200)));
    act(() => api.handleTouchEnd(touchEvent(200)));
    expect(onClick).toHaveBeenCalledTimes(1);

    drag(200, 120);
    act(() => api.handleTouchEnd(touchEvent(120)));
    act(() => api.handleTouchStart(touchEvent(120)));
    act(() => api.handleTouchEnd(touchEvent(120)));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disableRight 的卡片不能往右滑開', () => {
    render({ disableRight: true });
    drag(200, 280);
    expect(api.translateX).toBe(0);
  });
});
