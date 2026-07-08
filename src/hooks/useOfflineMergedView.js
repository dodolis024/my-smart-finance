import { useMemo } from 'react';
import { useOfflineSync } from '@/hooks/useOfflineSync';
import { buildQueuedRows, mergeQueuedIntoHistory, mergeQueuedIntoSummary } from '@/lib/offlineMerge';

/**
 * 離線佇列 → 儀表板畫面的合併層：
 * 包住 useOfflineSync（自動補送、佇列訂閱），把尚未同步的佇列交易
 * 併入當月交易列表與收支彙總，供列表、圖表、統計卡共用同一份合併後資料。
 *
 * @param {Array}  opts.history  當月交易列表（伺服器資料）
 * @param {object} opts.summary  當月收支彙總（伺服器資料）
 * @param {number} opts.year     目前檢視年份
 * @param {number} opts.month    目前檢視月份
 * @param {Function} [opts.onSynced]     補送成功 callback（result.synced 筆數）
 * @param {Function} [opts.onFailed]     補送失敗 callback（result.failed 筆數）
 * @param {Function} [opts.onNeedsLogin] 需重新登入 callback
 */
export function useOfflineMergedView({ history, summary, year, month, onSynced, onFailed, onNeedsLogin }) {
  const { queuedItems, pendingCount, flushNow, removeQueuedItem } = useOfflineSync({
    onSynced,
    onFailed,
    onNeedsLogin,
  });

  const queuedRows = useMemo(
    () => buildQueuedRows(queuedItems, year, month),
    [queuedItems, year, month]
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
