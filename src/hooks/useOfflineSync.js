import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { listQueue, flushQueue, subscribeQueue, removeQueued } from '@/lib/offlineQueue';

/**
 * 離線記帳佇列的 React 接線:
 * - 曝露佇列內容(pending + failed)供列表合併顯示
 * - autoFlush 時在掛載/恢復連線/回到前景自動補送
 * - 同步結果透過 callback 通知(呼叫端顯示 toast / 重新抓資料)
 *
 * @param {boolean} [opts.autoFlush=true] 是否由這個實例負責自動補送。
 *   自動補送的擁有者是 App 層的 OfflineSyncWatcher;只要佇列內容(如儀表板的
 *   合併顯示)的呼叫端須傳 false,否則同一次補送會跑出兩份 toast。
 */
export function useOfflineSync({ onSynced, onFailed, onNeedsLogin, autoFlush = true } = {}) {
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

  // 自動補送:掛載(登入完成)時一次 + 恢復連線 + 回到前景(含 bfcache 還原)。
  // 手機把 App 切到背景後頁面會被系統凍結,期間恢復連線的 'online' 事件收不到、
  // 回前景也不會補派;少了前景這個時機,待同步的帳會一路卡到使用者重開 App 或手動補送。
  useEffect(() => {
    if (!autoFlush || !user?.id) return;

    const flushIfQueued = () => {
      if (listQueue(user.id).length > 0) flushNow();
    };
    flushIfQueued();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') flushIfQueued();
    };
    window.addEventListener('online', flushIfQueued);
    window.addEventListener('pageshow', flushIfQueued);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('online', flushIfQueued);
      window.removeEventListener('pageshow', flushIfQueued);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [autoFlush, user?.id, flushNow]);

  const removeQueuedItem = useCallback(
    (id) => {
      if (user?.id) removeQueued(user.id, id);
    },
    [user?.id]
  );

  return { queuedItems, pendingCount: queuedItems.length, flushNow, removeQueuedItem };
}
