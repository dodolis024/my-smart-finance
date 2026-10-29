import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchTransactionsByDateRange, RANGE_FETCH_LIMIT } from '@/hooks/useTransactionSearch';
import { getCached, setCached } from '@/lib/resourceCache';
import { chartMonths, addMonths, daysInMonth, ymOf, FIXED_ITEM_RULE } from '@/lib/spendingAnalysis';

// 使用者改回「算進去」的大額單筆（交易 id 陣列）；存在 settings 跨裝置同步，不用另開資料表
export const INCLUDED_LARGE_ITEMS_KEY = 'spending_analysis_included';

// 切到別頁再回來時先用上次的資料畫，背景再重抓；每個月份各記一份
const rangeCacheKey = (ym) => `spending-analysis:range:${ym}`;
const FIRST_MONTH_CACHE_KEY = 'spending-analysis:first-month';
const INCLUDED_CACHE_KEY = 'spending-analysis:included';

/**
 * 消費分析頁的資料：目標月份往前 6 個月的支出（前後再多抓 3 個月，用來認固定支出）、
 * 帳本第一筆交易的月份，以及使用者手動改回「算進去」的大額單筆。計算交給 lib/spendingAnalysis.js。
 * 抓過的都記在記憶體（resourceCache，登出時清掉）：再回到這頁或切回看過的月份，先用記著的畫，背景重抓到了再換。
 */
export function useSpendingAnalysis(userId, year, month) {
  const targetYm = `${year}-${String(month).padStart(2, '0')}`;
  const [expenses, setExpenses] = useState(() => getCached(rangeCacheKey(targetYm), userId)?.expenses ?? []);
  const [firstYm, setFirstYm] = useState(() => getCached(FIRST_MONTH_CACHE_KEY, userId));
  const [includedIds, setIncludedIds] = useState(() => new Set(getCached(INCLUDED_CACHE_KEY, userId) ?? []));
  const [includedLoaded, setIncludedLoaded] = useState(() => getCached(INCLUDED_CACHE_KEY, userId) !== undefined);
  // 連續快速切換時，第二次要以第一次的結果為基礎寫入，不能等 state 重繪
  const includedRef = useRef(includedIds);
  const storeIncluded = useCallback((set) => {
    includedRef.current = set;
    setIncludedIds(set);
    setCached(INCLUDED_CACHE_KEY, userId, [...set]);
  }, [userId]);
  // 寫入排隊依序送出，後按的不會被先按、晚到的那次蓋掉
  const saveChainRef = useRef(Promise.resolve());
  const pendingSavesRef = useRef(0);
  const [capped, setCapped] = useState(() => getCached(rangeCacheKey(targetYm), userId)?.capped ?? false);
  const [loading, setLoading] = useState(() => getCached(rangeCacheKey(targetYm), userId) === undefined);
  const [error, setError] = useState(null);
  // 第一筆交易月份或大額設定讀不到：照常算會講錯話（「還沒有紀錄」、或之後切換蓋掉雲端清單），當成載入失敗
  const [metaError, setMetaError] = useState(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!userId) return;
    const reqId = ++requestIdRef.current;
    const months = chartMonths(targetYm);
    const startYm = addMonths(months[0], -FIXED_ITEM_RULE.withinMonths);
    const endYm = addMonths(targetYm, FIXED_ITEM_RULE.withinMonths);
    const cacheKey = rangeCacheKey(targetYm);
    const cached = getCached(cacheKey, userId);
    if (cached) {
      setExpenses(cached.expenses);
      setCapped(cached.capped);
    }
    setLoading(!cached);
    setError(null);
    fetchTransactionsByDateRange(userId, `${startYm}-01`, `${endYm}-${daysInMonth(endYm)}`, { limit: RANGE_FETCH_LIMIT, count: true })
      .then(({ rows, count, error: fetchError }) => {
        if (reqId !== requestIdRef.current) return;
        if (fetchError) throw fetchError;
        const next = { expenses: rows.filter((tx) => tx.type !== 'income'), capped: count > rows.length };
        setCached(cacheKey, userId, next);
        setExpenses(next.expenses);
        setCapped(next.capped);
      })
      .catch((err) => {
        // 有記著的資料就繼續顯示，背景重抓失敗不把整頁換成錯誤
        if (reqId === requestIdRef.current && !cached) setError(err);
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
        if (queryError) {
          if (getCached(FIRST_MONTH_CACHE_KEY, userId) === undefined) setMetaError(queryError);
          return;
        }
        const next = data?.date ? ymOf(data.date) : null;
        setCached(FIRST_MONTH_CACHE_KEY, userId, next);
        setFirstYm(next);
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
        if (queryError) {
          if (getCached(INCLUDED_CACHE_KEY, userId) === undefined) setMetaError(queryError);
        } else {
          storeIncluded(new Set(Array.isArray(data?.value) ? data.value : []));
        }
        setIncludedLoaded(true);
      });
    return () => { cancelled = true; };
  }, [userId, storeIncluded]);

  /**
   * 切換某筆大額單筆要不要算進分析；畫面先變，寫入失敗再退回。
   * 寫入前先讀雲端最新的清單、只改這一筆：另一個分頁或裝置剛切換的不會被這邊的舊清單蓋掉。
   * 失敗只退回這一筆，其他已經切換的不受影響。
   */
  const setLargeItemIncluded = useCallback((txId, included) => {
    if (!userId) return Promise.resolve();
    const withItem = (set, add) => {
      const next = new Set(set);
      if (add) next.add(txId);
      else next.delete(txId);
      return next;
    };
    storeIncluded(withItem(includedRef.current, included));
    pendingSavesRef.current += 1;
    const run = saveChainRef.current.then(async () => {
      const { data, error: readError } = await supabase
        .from('settings')
        .select('value')
        .eq('user_id', userId)
        .eq('key', INCLUDED_LARGE_ITEMS_KEY)
        .maybeSingle();
      const next = readError ? null : withItem(new Set(Array.isArray(data?.value) ? data.value : []), included);
      const { error: saveError } = next
        ? await supabase
          .from('settings')
          .upsert({ user_id: userId, key: INCLUDED_LARGE_ITEMS_KEY, value: [...next] }, { onConflict: 'user_id,key' })
        : { error: readError };
      if (saveError) {
        storeIncluded(withItem(includedRef.current, !included));
        throw saveError;
      }
      // 排在後面的還沒寫完就先不換，免得畫面閃回去；最後一筆寫完再對齊雲端（含別處切換的）
      if (pendingSavesRef.current === 1) storeIncluded(next);
    }).finally(() => { pendingSavesRef.current -= 1; });
    saveChainRef.current = run.catch(() => {});
    return run;
  }, [userId, storeIncluded]);

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
