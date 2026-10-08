import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * fetchCurrencies 的三個查詢（幣別清單、匯率預熱、預設幣別）互不相依，要同時發出；
 * 其中任何一個失敗都不能拖累另外兩個，也不能讓 fetchCurrencies 本身拋錯。
 */

const h = vi.hoisted(() => ({ pending: [] }));

function request(label) {
  return new Promise((resolve) => {
    h.pending.push({ label, resolve });
  });
}

vi.mock('@/lib/supabase', () => {
  const makeBuilder = (table) => {
    let p = null;
    let key = '';
    const b = {
      select: () => b,
      // settings 以 key 區分（掛載時另有 account_order 的查詢，與本測試無關）
      eq: (col, val) => { if (col === 'key') key = `:${val}`; return b; },
      maybeSingle: () => b,
      then: (res, rej) => {
        p ??= request(`from:${table}${key}`);
        return p.then(res, rej);
      },
    };
    return b;
  };
  return {
    supabase: {
      from: (table) => makeBuilder(table),
      rpc: (fn) => request(`rpc:${fn}`),
    },
  };
});
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k) => k }) }));

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

let result;
let root;
let container;

async function mount() {
  vi.resetModules();
  const { useDashboard } = await import('@/hooks/useDashboard');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  function Harness() {
    result = useDashboard();
    return null;
  }
  act(() => root.render(createElement(Harness)));
}

function respond(label, response) {
  const i = h.pending.findIndex((x) => x.label === label);
  const [item] = h.pending.splice(i, 1);
  item.resolve(response instanceof Error ? Promise.reject(response) : response);
}

beforeEach(() => {
  h.pending.length = 0;
  localStorage.clear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('fetchCurrencies', () => {
  it('三個查詢同時發出', async () => {
    await mount();
    const p = result.fetchCurrencies();
    await flush();
    const labels = h.pending.map((x) => x.label).filter((l) => l !== 'from:settings:account_order');
    expect(labels.sort()).toEqual([
      'from:exchange_rates',
      'from:settings:default_currency',
      'rpc:get_available_currencies',
    ]);
    respond('rpc:get_available_currencies', { data: ['USD', 'TWD'], error: null });
    respond('from:exchange_rates', { data: [{ currency_code: 'usd', rate: 32 }], error: null });
    respond('from:settings:default_currency', { data: { value: 'usd' }, error: null });
    await act(async () => { await p; });
    expect(result.currencies).toEqual(['TWD', 'USD']);
    expect(result.defaultCurrency).toBe('USD');
  });

  it('預設幣別不必等幣別清單回來', async () => {
    await mount();
    const p = result.fetchCurrencies();
    await flush();
    respond('from:settings:default_currency', { data: { value: 'jpy' }, error: null });
    await flush();
    expect(result.defaultCurrency).toBe('JPY');
    respond('rpc:get_available_currencies', { data: ['TWD', 'JPY'], error: null });
    respond('from:exchange_rates', { data: [], error: null });
    await act(async () => { await p; });
  });

  it('幣別清單失敗不影響預設幣別，也不拋錯', async () => {
    await mount();
    const p = result.fetchCurrencies();
    await flush();
    respond('rpc:get_available_currencies', new Error('Failed to fetch'));
    respond('from:exchange_rates', new Error('Failed to fetch'));
    respond('from:settings:default_currency', { data: { value: 'gbp' }, error: null });
    await act(async () => { await expect(p).resolves.toBeUndefined(); });
    expect(result.defaultCurrency).toBe('GBP');
    expect(result.currencies).toEqual(['TWD']);
  });

  it('預設幣別失敗維持 TWD，其他照常更新', async () => {
    await mount();
    const p = result.fetchCurrencies();
    await flush();
    respond('rpc:get_available_currencies', { data: ['TWD', 'EUR'], error: null });
    respond('from:exchange_rates', { data: [], error: null });
    respond('from:settings:default_currency', new Error('Failed to fetch'));
    await act(async () => { await expect(p).resolves.toBeUndefined(); });
    expect(result.defaultCurrency).toBe('TWD');
    expect(result.currencies).toEqual(['TWD', 'EUR']);
  });

  it('匯率預熱與預設幣別只抓一次，幣別清單每次都刷新', async () => {
    await mount();
    let p = result.fetchCurrencies();
    await flush();
    respond('rpc:get_available_currencies', { data: ['TWD'], error: null });
    respond('from:exchange_rates', { data: [], error: null });
    respond('from:settings:default_currency', { data: { value: 'TWD' }, error: null });
    await act(async () => { await p; });

    p = result.fetchCurrencies();
    await flush();
    expect(h.pending.map((x) => x.label).filter((l) => l !== 'from:settings:account_order'))
      .toEqual(['rpc:get_available_currencies']);
    respond('rpc:get_available_currencies', { data: ['TWD'], error: null });
    await act(async () => { await p; });
  });
});
