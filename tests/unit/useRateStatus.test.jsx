import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 首頁的「匯率已 N 天沒更新」：排程曾經壞掉 53 天沒人發現。
 * 只在資料庫的 updated_at 太舊時提示；查不到就不提示、不丟錯。
 */

const h = vi.hoisted(() => ({ result: { data: null, error: null }, calls: 0 }));
vi.mock('@/lib/supabase', () => {
  const b = {
    select: () => b, order: () => b, limit: () => b,
    maybeSingle: async () => { h.calls += 1; return h.result; },
  };
  return { supabase: { from: () => b } };
});

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

let container, root, hook;
async function mountHook() {
  const { useRateStatus } = await import('@/hooks/useRateStatus');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  function Probe() { hook = useRateStatus(); return null; }
  act(() => root.render(createElement(Probe)));
  await flush();
}

beforeEach(async () => {
  h.calls = 0;
  const { _resetRateStatusCache } = await import('@/hooks/useRateStatus');
  _resetRateStatusCache();
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('useRateStatus', () => {
  it('updated_at 是 5 天前 → staleDays 5', async () => {
    h.result = { data: { updated_at: new Date(Date.now() - 5.3 * 86400000).toISOString() }, error: null };
    await mountHook();
    expect(hook.staleDays).toBe(5);
  });

  it('今天更新過 → 0，不會觸發 3 天門檻', async () => {
    h.result = { data: { updated_at: new Date(Date.now() - 3600000).toISOString() }, error: null };
    await mountHook();
    expect(hook.staleDays).toBe(0);
  });

  it('查不到（離線或錯誤）→ null，不提示也不丟錯', async () => {
    h.result = { data: null, error: { message: 'offline' } };
    await mountHook();
    expect(hook.staleDays).toBeNull();
  });

  it('同一次載入只查一次', async () => {
    h.result = { data: { updated_at: new Date().toISOString() }, error: null };
    await mountHook();
    act(() => root.unmount()); container.remove();
    await mountHook();
    expect(h.calls).toBe(1);
  });
});
