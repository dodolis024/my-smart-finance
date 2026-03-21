import { useState, useCallback } from 'react';
import { CURRENT_VERSION } from '@/lib/constants';

const STORAGE_KEY = 'changelog-seen-version';

export function useChangelog() {
  const [hasUnread, setHasUnread] = useState(() =>
    localStorage.getItem(STORAGE_KEY) !== CURRENT_VERSION
  );

  const markAsRead = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, CURRENT_VERSION);
    setHasUnread(false);
  }, []);

  return { hasUnread, markAsRead };
}
