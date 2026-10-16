import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { useCachedResource } from '@/hooks/useCachedResource';
import { subscribe, getCached, setCached, clearAllCaches } from '@/lib/resourceCache';

/**
 * 冷快取掛載不可廣播 initial。
 *
 * setCached 會同步通知同一個 key 的所有訂閱者，所以把 initial（空清單這種佔位值）
 * 寫進快取，等於把別處已經載好的真資料蓋掉。實例：第一次打開「設定」時 useSettings
 * 冷掛載，廣播出空的 expenseCategories，儀表板的記帳表單分類下拉整個變空——資料回來
 * 前把設定關掉（或那次查詢失敗），就會一路空到使用者重整。
 */

const INITIAL = { categories: [] };
const REAL = { categories: ['飲食', '交通'] };

let container;
let root;
let seen;
let unsub;

let api;
function Consumer({ userId, fetcher }) {
  api = useCachedResource('settings', { userId, initial: INITIAL, fetcher });
  return null;
}

const render = (props) => act(() => { root.render(createElement(Consumer, props)); });

beforeEach(() => {
  clearAllCaches();
  seen = [];
  unsub = subscribe('settings', () => seen.push(getCached('settings', 'u1')));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  unsub();
  act(() => root.unmount());
  container.remove();
});

describe('useCachedResource 冷快取掛載', () => {
  it('資料還沒回來時不寫入快取、不通知訂閱者', () => {
    render({ userId: 'u1', fetcher: () => new Promise(() => {}) });

    expect(seen).toEqual([]);
    expect(getCached('settings', 'u1')).toBeUndefined();
  });

  it('load 成功後才寫入快取並通知訂閱者', async () => {
    render({ userId: 'u1', fetcher: vi.fn().mockResolvedValue(REAL) });
    expect(seen).toEqual([]);

    await act(async () => { await api.load(); });

    expect(seen).toEqual([REAL]);
    expect(getCached('settings', 'u1')).toEqual(REAL);
  });

  it('切換到冷快取的另一個帳號時，不會把佔位值寫進新帳號的快取', async () => {
    setCached('settings', 'u1', REAL);
    seen.length = 0;
    render({ userId: 'u1', fetcher: () => new Promise(() => {}) });
    render({ userId: 'u2', fetcher: () => new Promise(() => {}) });

    expect(getCached('settings', 'u2')).toBeUndefined();
    // u1 的真資料不可被 u2 的空白頁覆蓋
    expect(getCached('settings', 'u1')).toEqual(REAL);
  });

  it('熱快取掛載照舊沿用快取值', () => {
    setCached('settings', 'u1', REAL);
    seen.length = 0;
    render({ userId: 'u1', fetcher: () => new Promise(() => {}) });

    expect(getCached('settings', 'u1')).toEqual(REAL);
  });
});
