import { useState, useCallback, useEffect, useRef } from 'react';
import { getCached, setCached } from '@/lib/resourceCache';

/**
 * 共用的「以 userId 綁定的模組級快取資源」hook。
 *
 * 取代各資料 hook 手刻的快取樣板，行為對齊原樣板：
 *   - 初始化：同一 userId 有快取則沿用，否則用 initial
 *   - loading：僅在「冷快取」（未命中）時為 true / 於 load 時轉圈
 *   - 每次 data 變動同步寫回快取（供跨元件、卸載後重掛沿用）
 *   - load：非同步取資料；錯誤寫入 error 並重新拋出（讓呼叫端維持原本的拋錯語意）
 *
 * @param {string} key       快取鍵（全域唯一，如 'subscriptions'）
 * @param {object} opts
 * @param {string|undefined} opts.userId   目前使用者 id（切換帳號時快取自動失效）
 * @param {*}      opts.initial  無快取時的初始值
 * @param {Function} opts.fetcher 取資料的 async 函式，回傳值將成為新的 data
 * @returns {{ data, setData, loading, error, load }}
 */
export function useCachedResource(key, { userId, initial, fetcher }) {
  const [data, setData] = useState(() => {
    const cached = getCached(key, userId);
    return cached !== undefined ? cached : initial;
  });
  const [loading, setLoading] = useState(() => getCached(key, userId) === undefined);
  const [error, setError] = useState(null);

  // userId 變更時（同分頁登出→換帳號）於 render 期重置為新使用者的快取/初始值。
  // 沒有這段的話，下方「state → 快取」的同步 effect 會在 data 還是前一位使用者的
  // 那一刻先跑一次，把舊資料寫進新使用者的快取 key（常駐元件如 useTimezoneSync
  // 會踩到）。Render 期 setState 是 React 官方的 derive-state-from-props 模式，
  // 會在本次 render 直接以新值重跑，effect 只會看到重置後的狀態。
  const [prevIdentity, setPrevIdentity] = useState(() => `${key}:${userId ?? ''}`);
  const identity = `${key}:${userId ?? ''}`;
  if (prevIdentity !== identity) {
    setPrevIdentity(identity);
    const cached = getCached(key, userId);
    setData(cached !== undefined ? cached : initial);
    setLoading(cached === undefined);
    setError(null);
  }

  // fetcher 以 ref 保存，讓 load 的識別只隨 [key, userId] 變動，
  // 避免呼叫端每次 render 重建 fetcher 而造成 load 變動、進而觸發 effect 無限迴圈。
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  // 同步 state → 快取
  useEffect(() => {
    setCached(key, userId, data);
  }, [key, userId, data]);

  const load = useCallback(async () => {
    if (!userId) return;
    // 僅在冷快取時顯示 spinner，熱快取背景刷新不打斷畫面
    if (getCached(key, userId) === undefined) setLoading(true);
    setError(null);
    try {
      const result = await fetcherRef.current();
      setData(result);
    } catch (e) {
      setError(e);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [key, userId]);

  return { data, setData, loading, error, load };
}
