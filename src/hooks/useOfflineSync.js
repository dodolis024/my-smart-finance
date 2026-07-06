import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { listQueue, flushQueue, subscribeQueue, removeQueued } from '@/lib/offlineQueue';

/**
 * 離線記帳佇列的 React 接線:
 * - 曝露佇列內容(pending + failed)供列表合併顯示
 * - 掛載時與 'online' 事件時自動補送
 * - 同步結果透過 callback 通知(呼叫端顯示 toast / 重新抓資料)
 */
export function useOfflineSync({ onSynced, onFailed, onNeedsLogin } = {}) {
  const { user } = useAuth();
  const [queuedItems, setQueuedItems] = useState(() => listQueue(user?.id));

  // callback 走 ref,避免呼叫端每次 render 產生新函式導致 effect 重跑
  const callbacksRef = useRef({ onSynced, onFailed, onNeedsLogin });
  callbacksRef.current = { onSynced, onFailed, onNeedsLogin };

  useEffect(() => {
    if (!user?.id) {
      setQueuedItems([]);
      return;
    }
    const refresh = () => setQueuedItems(listQueue(user.id));
    refresh();
    return subscribeQueue(refresh);
  }, [user?.id]);

  const flushNow = useCallback(
    async ({ includeFailed = false } = {}) => {
      if (!user?.id) return null;
      const result = await flushQueue(user.id, { includeFailed });
      const { onSynced: synced, onFailed: failed, onNeedsLogin: needsLogin } = callbacksRef.current;
      if (result.synced > 0) synced?.(result);
      if (result.failed > 0) failed?.(result);
      if (result.needsLogin) needsLogin?.(result);
      return result;
    },
    [user?.id]
  );

  // 自動補送:掛載(登入完成)時一次 + 每次恢復連線時
  useEffect(() => {
    if (!user?.id) return;
    if (listQueue(user.id).length > 0) flushNow();

    const handleOnline = () => flushNow();
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [user?.id, flushNow]);

  const removeQueuedItem = useCallback(
    (id) => {
      if (user?.id) removeQueued(user.id, id);
    },
    [user?.id]
  );

  return { queuedItems, pendingCount: queuedItems.length, flushNow, removeQueuedItem };
}
