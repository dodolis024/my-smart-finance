import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchTransactionsByDateRange, RANGE_FETCH_LIMIT } from '@/hooks/useTransactionSearch';
import { chartMonths, addMonths, daysInMonth, ymOf, FIXED_ITEM_RULE } from '@/lib/spendingAnalysis';

// 使用者改回「算進去」的大額單筆（交易 id 陣列）；存在 settings 跨裝置同步，不用另開資料表
export const INCLUDED_LARGE_ITEMS_KEY = 'spending_analysis_included';

/**
 * 消費分析頁的資料：目標月份往前 6 個月的支出（前後再多抓 3 個月，用來認固定支出）、
 * 帳本第一筆交易的月份，以及使用者手動改回「算進去」的大額單筆。計算交給 lib/spendingAnalysis.js。
 */
export function useSpendingAnalysis(userId, year, month) {
  const [expenses, setExpenses] = useState([]);
  const [firstYm, setFirstYm] = useState(undefined);
  const [includedIds, setIncludedIds] = useState(() => new Set());
  const [includedLoaded, setIncludedLoaded] = useState(false);
  // 連續快速切換時，第二次要以第一次的結果為基礎寫入，不能等 state 重繪
  const includedRef = useRef(includedIds);
  // 寫入排隊依序送出，後按的不會被先按、晚到的那次蓋掉
  const saveChainRef = useRef(Promise.resolve());
  const [capped, setCapped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // 第一筆交易月份或大額設定讀不到：照常算會講錯話（「還沒有紀錄」、或之後切換蓋掉雲端清單），當成載入失敗
  const [metaError, setMetaError] = useState(null);
  const requestIdRef = useRef(0);

  const targetYm = `${year}-${String(month).padStart(2, '0')}`;

  useEffect(() => {
    if (!userId) return;
    const reqId = ++requestIdRef.current;
    const months = chartMonths(targetYm);
    const startYm = addMonths(months[0], -FIXED_ITEM_RULE.withinMonths);
    const endYm = addMonths(targetYm, FIXED_ITEM_RULE.withinMonths);
    setLoading(true);
    setError(null);
    fetchTransactionsByDateRange(userId, `${startYm}-01`, `${endYm}-${daysInMonth(endYm)}`, { limit: RANGE_FETCH_LIMIT, count: true })
      .then(({ rows, count, error: fetchError }) => {
        if (reqId !== requestIdRef.current) return;
        if (fetchError) throw fetchError;
        setExpenses(rows.filter((tx) => tx.type !== 'income'));
        setCapped(count > rows.length);
      })
      .catch((err) => {
        if (reqId === requestIdRef.current) setError(err);
      })
      .finally(() => {
        if (reqId === requestIdRef.current) setLoading(false);
      });
  }, [userId, targetYm]);

  // 帳本第一個月不算進「平常」，所以要知道最早一筆交易落在哪個月（只查一次）
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    supabase
      .from('transactions')
      .select('date')
      .eq('user_id', userId)
      .order('date', { ascending: true })
      .limit(1)
      .maybeSingle()
      .then(({ data, error: queryError }) => {
        if (cancelled) return;
        if (queryError) setMetaError(queryError);
        setFirstYm(data?.date ? ymOf(data.date) : null);
      });
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    supabase
      .from('settings')
      .select('value')
      .eq('user_id', userId)
      .eq('key', INCLUDED_LARGE_ITEMS_KEY)
      .maybeSingle()
      .then(({ data, error: queryError }) => {
        if (cancelled) return;
        if (queryError) setMetaError(queryError);
        else if (Array.isArray(data?.value)) {
          includedRef.current = new Set(data.value);
          setIncludedIds(includedRef.current);
        }
        setIncludedLoaded(true);
      });
    return () => { cancelled = true; };
  }, [userId]);

  /**
   * 切換某筆大額單筆要不要算進分析；畫面先變，寫入失敗再退回。
   * 每次寫入送的是「輪到它時」最新的整份清單；失敗只退回這一筆，其他已經切換的不受影響。
   */
  const setLargeItemIncluded = useCallback((txId, included) => {
    if (!userId) return Promise.resolve();
    const withItem = (set, add) => {
      const next = new Set(set);
      if (add) next.add(txId);
      else next.delete(txId);
      return next;
    };
    includedRef.current = withItem(includedRef.current, included);
    setIncludedIds(includedRef.current);
    const run = saveChainRef.current.then(async () => {
      const { error: saveError } = await supabase
        .from('settings')
        .upsert({ user_id: userId, key: INCLUDED_LARGE_ITEMS_KEY, value: [...includedRef.current] }, { onConflict: 'user_id,key' });
      if (saveError) {
        includedRef.current = withItem(includedRef.current, !included);
        setIncludedIds(includedRef.current);
        throw saveError;
      }
    });
    saveChainRef.current = run.catch(() => {});
    return run;
  }, [userId]);

  return {
    targetYm,
    expenses,
    firstYm,
    includedIds,
    // 第一筆交易的月份、大額設定還沒查回來時也算載入中：避免先用錯的「平常」閃一下，
    // 也避免設定還沒到就讓人切換，把雲端已存的清單蓋掉
    loading: loading || firstYm === undefined || !includedLoaded,
    error: error || metaError,
    // 交易筆數超過讀取上限：依日期由舊到新讀，沒讀到的是最新的部分，數字會偏低
    capped,
    setLargeItemIncluded,
  };
}
