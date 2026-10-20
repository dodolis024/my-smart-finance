import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 瀏覽器「封鎖所有 cookie／網站資料」時，碰 window.localStorage 會直接丟 SecurityError。
 * ThemeProvider 在 App 最外層的 render 期初始化，這裡若沒接住，整個 App 只剩錯誤頁。
 * 主題只是外觀：讀不到就用預設，寫不進去就不跨重整保留，但絕不能炸。
 */

const { ThemeProvider, useTheme } = await import('@/hooks/useTheme');

let container, root, api;
function Probe() {
  api = useTheme();
  return null;
}

// 受測程式讀的是裸的 `localStorage`，vitest 的 jsdom 環境把它同時掛在 window 與 globalThis 上，
// 兩邊都要蓋成會丟錯的 getter；測完照原本的 descriptor 還原
const targets = [...new Set([window, globalThis])];
let originals = [];
function blockStorage() {
  originals = targets.map((obj) => [obj, Object.getOwnPropertyDescriptor(obj, 'localStorage')]);
  for (const obj of targets) {
    Object.defineProperty(obj, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('Access is denied for this document.', 'SecurityError'); },
    });
  }
}
function restoreStorage() {
  for (const [obj, desc] of originals) {
    if (desc) Object.defineProperty(obj, 'localStorage', desc);
    else delete obj.localStorage;
  }
  originals = [];
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  restoreStorage();
  document.documentElement.removeAttribute('data-theme');
});

describe('localStorage 被封鎖', () => {
  it('ThemeProvider 照常渲染，主題退回預設', () => {
    blockStorage();
    expect(() => localStorage).toThrow(/denied/);
    expect(() => act(() => root.render(createElement(ThemeProvider, null, createElement(Probe))))).not.toThrow();
    expect(api.theme).toBe('default');
    expect(api.shuffleEnabled).toBe(false);
    expect(api.shuffleInterval).toBe('daily');
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });

  it('切主題與輪換設定不會丟錯，畫面仍套用新主題', () => {
    blockStorage();
    act(() => root.render(createElement(ThemeProvider, null, createElement(Probe))));
    expect(() => act(() => api.setTheme('rose'))).not.toThrow();
    expect(api.theme).toBe('rose');
    expect(document.documentElement.getAttribute('data-theme')).toBe('rose');
    expect(() => act(() => { api.setShuffleEnabled(true); api.setShuffleInterval('weekly'); api.setShuffleThemes(['rose', 'soda']); })).not.toThrow();
    expect(api.shuffleEnabled).toBe(true);
  });
});

describe('localStorage 正常', () => {
  it('切主題仍會寫進儲存（確認封鎖的 try/catch 沒把正常路徑也吞掉）', () => {
    // config/vitest.setup.js 另建了一個 JSDOM 掛在 window 上，受測程式的裸 localStorage 是 globalThis 那份
    const store = globalThis.localStorage;
    store.removeItem('app-theme');
    act(() => root.render(createElement(ThemeProvider, null, createElement(Probe))));
    act(() => api.setTheme('soda'));
    expect(store.getItem('app-theme')).toBe('soda');
    store.removeItem('app-theme');
  });
});
