import { useState, useCallback } from 'react';
import { CURRENT_VERSION } from '@/lib/constants';

function storageKey(userId) {
  return userId ? `changelog-seen-version:${userId}` : 'changelog-seen-version';
}

export function useChangelog(userId) {
  const [hasUnread, setHasUnread] = useState(() =>
    localStorage.getItem(storageKey(userId)) !== CURRENT_VERSION
  );

  const markAsRead = useCallback(() => {
    localStorage.setItem(storageKey(userId), CURRENT_VERSION);
    setHasUnread(false);
  }, [userId]);

  return { hasUnread, markAsRead };
}
