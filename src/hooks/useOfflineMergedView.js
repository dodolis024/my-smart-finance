import { useMemo } from 'react';
import { useOfflineSync } from '@/hooks/useOfflineSync';
import { buildQueuedRows, mergeQueuedIntoHistory, mergeQueuedIntoSummary } from '@/lib/offlineMerge';

/**
 * 離線佇列 → 儀表板畫面的合併層：
 * 包住 useOfflineSync（佇列訂閱），把尚未同步的佇列交易
 * 併入目前檢視期間的交易列表與收支彙總，供列表、圖表、統計卡共用同一份合併後資料。
 *
 * 自動補送不歸這裡管（autoFlush: false），由 App 層的 OfflineSyncWatcher 統一負責，
 * 否則使用者停在其他分頁時不會補送，且同一次補送會跑出兩份 toast。
 * 這裡的 callback 只服務使用者手動點「待同步」藥丸觸發的 flushNow。
 *
 * @param {Array}  opts.history    期間內交易列表（伺服器資料）
 * @param {object} opts.summary    期間收支彙總（伺服器資料）
 * @param {string} opts.startDate  期間起日 'YYYY-MM-DD'（含）
 * @param {string} opts.endDate    期間迄日 'YYYY-MM-DD'（含）
 * @param {Function} [opts.onSynced]     補送成功 callback（result.synced 筆數）
 * @param {Function} [opts.onFailed]     補送失敗 callback（result.failed 筆數）
 * @param {Function} [opts.onNeedsLogin] 需重新登入 callback
 */
export function useOfflineMergedView({ history, summary, startDate, endDate, onSynced, onFailed, onNeedsLogin }) {
  const { queuedItems, pendingCount, flushNow, removeQueuedItem } = useOfflineSync({
    onSynced,
    onFailed,
    onNeedsLogin,
    autoFlush: false,
  });

  const queuedRows = useMemo(
    () => buildQueuedRows(queuedItems, startDate, endDate),
    [queuedItems, startDate, endDate]
  );
  const displayHistory = useMemo(
    () => mergeQueuedIntoHistory(history, queuedRows),
    [history, queuedRows]
  );
  const displaySummary = useMemo(
    () => mergeQueuedIntoSummary(summary, queuedRows),
    [summary, queuedRows]
  );

  return { queuedItems, pendingCount, flushNow, removeQueuedItem, displayHistory, displaySummary };
}
