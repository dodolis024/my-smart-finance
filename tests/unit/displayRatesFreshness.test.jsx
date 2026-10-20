import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 顯示幣別的匯率表以前只在「同一次頁面載入」內快取，但 PWA 常好幾天不重新整理，
 * 首頁的英鎊換算會一直用第一天抓到的匯率。現在每張表記抓取時間，
 * 資料庫排程更新過之後就重抓；還新鮮就不抓。
 */

const h = vi.hoisted(() => ({ fetches: 0 }));

vi.mock('@/lib/supabase', () => {
  const builder = (result) => {
    const b = {
      select: () => b, eq: () => b, order: () => b, range: () => b, maybeSingle: async () => result,
      then: (resolve) => resolve(result),
    };
    return b;
  };
  return {
    supabase: {
      from: (table) => {
        if (table === 'exchange_rate_history') return builder({ data: [], error: null });
        h.fetches += 1;
        return builder({ data: { rate: 40 }, error: null });
      },
    },
  };
});

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

let container, root, hook;
async function mountHook(currency) {
  vi.resetModules();
  const { useDisplayRates } = await import('@/hooks/useDisplayRates');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  function Probe() { hook = useDisplayRates(currency); return null; }
  act(() => root.render(createElement(Probe)));
  await flush();
}

beforeEach(() => { h.fetches = 0; localStorage.clear(); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

describe('useDisplayRates 的快取期限', () => {
  it('同一次載入內還新鮮就不重抓', async () => {
    await mountHook('GBP');
    expect(h.fetches).toBe(1);
    expect(hook?.live).toBe(40);
    // 同一個模組再掛一次（切頁回來）：memory 命中，不多抓
    const { useDisplayRates } = await import('@/hooks/useDisplayRates');
    const c2 = document.createElement('div');
    const r2 = createRoot(c2);
    function Probe2() { useDisplayRates('GBP'); return null; }
    act(() => r2.render(createElement(Probe2)));
    await flush();
    expect(h.fetches).toBe(1);
    act(() => r2.unmount());
  });

  it('資料庫排程更新過之後，記憶體裡那張表就算過期，會再抓一次', async () => {
    const { lastRateUpdateAt } = await import('@/lib/rateFreshness');
    const realNow = Date.now();
    // 第一次抓的時間落在「最近一次排程更新」之前一分鐘
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(lastRateUpdateAt(realNow) - 60 * 1000);
    await mountHook('GBP');
    expect(h.fetches).toBe(1);
    // 時間走到現在（排程已經更新過），再掛一次要重抓
    nowSpy.mockReturnValue(realNow);
    const { useDisplayRates } = await import('@/hooks/useDisplayRates');
    const c2 = document.createElement('div');
    const r2 = createRoot(c2);
    function Probe2() { useDisplayRates('GBP'); return null; }
    act(() => r2.render(createElement(Probe2)));
    await flush();
    expect(h.fetches).toBe(2);
    act(() => r2.unmount());
  });
});
