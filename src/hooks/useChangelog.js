import { useState, useCallback, useEffect } from 'react';

function storageKey(userId) {
  return userId ? `changelog-seen-version:${userId}` : 'changelog-seen-version';
}

// 最新版本號直接從 CHANGELOG 解析，不再依賴手動維護的常數，
// 避免發版時忘記同步版本號導致未讀燈號失效。
// 版本號在一次 App 生命週期內不會變，故以模組級 promise 快取：
// 整份 CHANGELOG 只下載一次，之後 userId 變動（登入／換帳號）僅重算已讀比對。
let latestVersionPromise = null;

function fetchLatestVersion() {
  if (!latestVersionPromise) {
    latestVersionPromise = fetch(`${import.meta.env.BASE_URL}CHANGELOG.zh.md`, { cache: 'no-cache' })
      .then((r) => r.text())
      .then((text) => text.match(/^## \[([^\]]+)\]/m)?.[1] ?? null)
      .catch((err) => {
        console.error('[Changelog] version check failed:', err);
        latestVersionPromise = null; // 失敗不快取，下次掛載重試
        return null;
      });
  }
  return latestVersionPromise;
}

export function useChangelog(userId) {
  const [latestVersion, setLatestVersion] = useState(null);
  const [hasUnread, setHasUnread] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchLatestVersion().then((version) => {
      if (cancelled || !version) return;
      setLatestVersion(version);
      setHasUnread(localStorage.getItem(storageKey(userId)) !== version);
    });
    return () => { cancelled = true; };
  }, [userId]);

  const markAsRead = useCallback(() => {
    if (!latestVersion) return;
    localStorage.setItem(storageKey(userId), latestVersion);
    setHasUnread(false);
  }, [userId, latestVersion]);

  return { hasUnread, markAsRead };
}
