import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { getNowHm } from '@/lib/utils';

// 逐筆勾選的成功提示要等使用者停手才跳：一邊看清單一邊勾，每下之間常停 1～2 秒，
// 2.5 秒涵蓋得住；再長的話人已經關掉明細去做別的事，提示反而來得莫名其妙
export const EXCLUSION_SUMMARY_DELAY_MS = 2500;

/**
 * @param {string} groupId
 * @param {object} [options]
 * @param {Function} [options.onExclusionsSettled]  停手 EXCLUSION_SUMMARY_DELAY_MS 且背景做完後呼叫一次：
 *   ({ removed, ledgerUpdated }) → removed 為這段期間從帳本移除的筆數、ledgerUpdated 為有沒有重新同步；
 *   帳本沒有任何變動就不呼叫
 * @param {Function} [options.onExclusionError]  有寫入失敗時立即呼叫：(errors) → 失敗項目已退回原狀
 */
export function useSplitSync(groupId, { onExclusionsSettled, onExclusionError } = {}) {
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);
  // 逐筆排除：勾選當下就改畫面（expenseId → 期望的 excluded），寫入排隊在背景做
  const [pendingExcluded, setPendingExcluded] = useState({});
  const [updatingExclusions, setUpdatingExclusions] = useState(false);

  const pendingRef = useRef({});
  const queueRef = useRef([]);
  const drainingRef = useRef(false);
  // 所有會寫帳本的操作都排在這條鏈上依序執行：兩次同步同時跑，
  // 會對同一筆費用各插入一次交易，撞上 (user_id, expense_id) 唯一索引
  const chainRef = useRef(Promise.resolve());
  const syncedRef = useRef(false);
  const settledRef = useRef(onExclusionsSettled);
  const errorRef = useRef(onExclusionError);
  const summaryRef = useRef({ removed: 0, ledgerUpdated: false });
  const summaryTimerRef = useRef(null);

  useEffect(() => { syncedRef.current = !!syncStatus?.synced; }, [syncStatus?.synced]);
  useEffect(() => { settledRef.current = onExclusionsSettled; }, [onExclusionsSettled]);
  useEffect(() => { errorRef.current = onExclusionError; }, [onExclusionError]);
  useEffect(() => () => clearTimeout(summaryTimerRef.current), []);

  const serialize = useCallback((task) => {
    const run = chainRef.current.then(task, task);
    chainRef.current = run.catch(() => {});
    return run;
  }, []);

  const fetchSyncStatus = useCallback(async () => {
    if (!groupId) return;
    const { data, error } = await supabase.rpc('get_split_sync_status', {
      p_group_id: groupId,
    });
    if (!error && data) setSyncStatus(data);
  }, [groupId]);

  const syncToLedger = useCallback(async () => {
    if (!groupId) return { success: false };
    setSyncing(true);
    try {
      return await serialize(async () => {
        // 新建交易的時間帶裝置本地時間，與手動記帳同一個時鐘；
        // 不帶的話資料庫只能用自己的時鐘，而它是 UTC
        const { data, error } = await supabase.rpc('sync_split_to_ledger', {
          p_group_id: groupId,
          p_time: getNowHm(),
        });
        if (error) throw error;
        await fetchSyncStatus();
        return data;
      });
    } finally {
      setSyncing(false);
    }
  }, [groupId, fetchSyncStatus, serialize]);

  // 依序送出佇列裡的排除切換；關掉由 RPC 原子刪除帳本那筆，
  // 重新勾選只移除排除紀錄，整批做完、群組同步過，才統一同步一次把它們加回
  const processQueue = useCallback(async (result) => {
    while (queueRef.current.length) {
      let included = false;
      while (queueRef.current.length) {
        const expenseId = queueRef.current.shift();
        const excluded = pendingRef.current[expenseId];
        const { data, error } = await supabase.rpc('set_split_sync_excluded', {
          p_expense_id: expenseId,
          p_excluded: excluded,
        });
        if (error) {
          result.errors.push(error);
          continue;
        }
        result.removed += data?.removed || 0;
        if (!excluded) included = true;
      }
      if (included && syncedRef.current) {
        const { error } = await supabase.rpc('sync_split_to_ledger', {
          p_group_id: groupId,
          p_time: getNowHm(),
        });
        if (error) result.errors.push(error);
        else result.ledgerUpdated = true;
      }
      await fetchSyncStatus();
      // 抓回的狀態已含處理完的項目（失敗的也因此退回原狀）；
      // 處理期間又被點、還在排隊的，保留畫面上的勾選
      const keep = {};
      for (const id of queueRef.current) keep[id] = pendingRef.current[id];
      pendingRef.current = keep;
      setPendingExcluded(keep);
    }
  }, [groupId, fetchSyncStatus]);

  const drainExclusions = useCallback(() => serialize(async () => {
    const result = { removed: 0, ledgerUpdated: false, errors: [] };
    try {
      await processQueue(result);
    } catch (err) {
      // 例如網路中斷時 rpc 直接 throw：放棄這批，畫面退回伺服器狀態
      result.errors.push(err);
      queueRef.current = [];
      pendingRef.current = {};
      setPendingExcluded({});
      fetchSyncStatus();
    } finally {
      drainingRef.current = false;
      setUpdatingExclusions(false);
    }
    if (result.errors.length) errorRef.current?.(result.errors);
    // 成功的部分累積起來，停手一段時間才總結提示一次
    const summary = summaryRef.current;
    summary.removed += result.removed;
    summary.ledgerUpdated ||= result.ledgerUpdated;
    if (summary.removed || summary.ledgerUpdated) {
      clearTimeout(summaryTimerRef.current);
      summaryTimerRef.current = setTimeout(() => {
        summaryRef.current = { removed: 0, ledgerUpdated: false };
        settledRef.current?.(summary);
      }, EXCLUSION_SUMMARY_DELAY_MS);
    }
  }), [fetchSyncStatus, processQueue, serialize]);

  const setExcluded = useCallback((expenseId, excluded) => {
    // 又點了一下：還沒停手，總結提示重新計時（等這批做完才重新排）
    clearTimeout(summaryTimerRef.current);
    pendingRef.current = { ...pendingRef.current, [expenseId]: excluded };
    setPendingExcluded(pendingRef.current);
    if (!queueRef.current.includes(expenseId)) queueRef.current.push(expenseId);
    if (!drainingRef.current) {
      drainingRef.current = true;
      setUpdatingExclusions(true);
      drainExclusions();
    }
  }, [drainExclusions]);

  // 同步明細要顯示的清單：伺服器資料蓋上還在背景處理的勾選
  const syncItems = useMemo(
    () => (syncStatus?.items || []).map((item) => (
      item.expense_id in pendingExcluded ? { ...item, excluded: pendingExcluded[item.expense_id] } : item
    )),
    [syncStatus?.items, pendingExcluded],
  );

  return {
    syncStatus, syncing, fetchSyncStatus, syncToLedger,
    setExcluded, syncItems, updatingExclusions,
  };
}
