import { useState, useCallback, useEffect } from 'react';

function storageKey(userId) {
  return userId ? `changelog-seen-version:${userId}` : 'changelog-seen-version';
}

// 最新版本號直接從 CHANGELOG 解析，不再依賴手動維護的常數，
// 避免發版時忘記同步版本號導致未讀燈號失效。
export function useChangelog(userId) {
  const [latestVersion, setLatestVersion] = useState(null);
  const [hasUnread, setHasUnread] = useState(false);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}CHANGELOG.zh.md`, { cache: 'no-cache' })
      .then((r) => r.text())
      .then((text) => {
        const version = text.match(/^## \[([^\]]+)\]/m)?.[1];
        if (!version) return;
        setLatestVersion(version);
        setHasUnread(localStorage.getItem(storageKey(userId)) !== version);
      })
      .catch((err) => console.error('[Changelog] version check failed:', err));
  }, [userId]);

  const markAsRead = useCallback(() => {
    if (!latestVersion) return;
    localStorage.setItem(storageKey(userId), latestVersion);
    setHasUnread(false);
  }, [userId, latestVersion]);

  return { hasUnread, markAsRead };
}
