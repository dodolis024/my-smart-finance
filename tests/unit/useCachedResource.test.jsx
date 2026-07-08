import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { useCachedResource } from '@/hooks/useCachedResource';
import { getCached, clearAllCaches } from '@/lib/resourceCache';

// React 18 的 act() 需要此旗標,否則 concurrent 更新不會同步 flush
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const KEY = 'test-resource';

/** 極簡 renderHook:掛載使用 useCachedResource 的元件,曝露最新回傳值與 rerender */
function renderCachedResource(initialProps) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  const result = { current: null };
  function Harness({ userId, fetcher }) {
    result.current = useCachedResource(KEY, { userId, initial: null, fetcher });
    return null;
  }

  const render = (props) => {
    act(() => {
      root.render(createElement(Harness, props));
    });
  };
  render(initialProps);

  return {
    result,
    rerender: render,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('useCachedResource', () => {
  let harness;

  beforeEach(() => {
    clearAllCaches();
  });

  afterEach(() => {
    harness?.unmount();
    harness = null;
  });

  it('冷快取時 loading 為 true,load 後寫入快取', async () => {
    harness = renderCachedResource({ userId: 'user-a', fetcher: async () => 'a-data' });
    expect(harness.result.current.loading).toBe(true);

    await act(async () => {
      await harness.result.current.load();
    });

    expect(harness.result.current.data).toBe('a-data');
    expect(harness.result.current.loading).toBe(false);
    expect(getCached(KEY, 'user-a')).toBe('a-data');
  });

  it('同一 userId 重新掛載時沿用快取且不轉圈', async () => {
    harness = renderCachedResource({ userId: 'user-a', fetcher: async () => 'a-data' });
    await act(async () => {
      await harness.result.current.load();
    });
    harness.unmount();

    harness = renderCachedResource({ userId: 'user-a', fetcher: async () => 'a-data' });
    expect(harness.result.current.data).toBe('a-data');
    expect(harness.result.current.loading).toBe(false);
  });

  it('換帳號時不得把前一位使用者的資料寫進新使用者的快取(回歸:常駐元件跨登入)', async () => {
    // 模擬 AppShell 常駐元件:同一個掛載點經歷 A 登入 → 登出 → B 登入
    harness = renderCachedResource({ userId: 'user-a', fetcher: async () => 'a-data' });
    await act(async () => {
      await harness.result.current.load();
    });
    expect(getCached(KEY, 'user-a')).toBe('a-data');

    // 登出:userId 變 undefined,快取清空(比照 AuthContext 的 SIGNED_OUT)
    clearAllCaches();
    harness.rerender({ userId: undefined, fetcher: async () => 'never' });

    // B 登入:此刻 data 不得殘留 A 的值,B 的快取 key 也不得被污染
    harness.rerender({ userId: 'user-b', fetcher: async () => 'b-data' });
    expect(harness.result.current.data).toBe(null);
    expect(harness.result.current.loading).toBe(true);
    expect(getCached(KEY, 'user-b')).not.toBe('a-data');

    await act(async () => {
      await harness.result.current.load();
    });
    expect(harness.result.current.data).toBe('b-data');
    expect(getCached(KEY, 'user-b')).toBe('b-data');
  });

  it('load 失敗時寫入 error 並重新拋出', async () => {
    const boom = new Error('boom');
    harness = renderCachedResource({
      userId: 'user-a',
      fetcher: async () => {
        throw boom;
      },
    });

    let caught = null;
    await act(async () => {
      try {
        await harness.result.current.load();
      } catch (e) {
        caught = e;
      }
    });
    expect(caught).toBe(boom);
    expect(harness.result.current.error).toBe(boom);
  });
});
