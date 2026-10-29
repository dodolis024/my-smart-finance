import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { SELECT_COLUMNS, mapSearchRow } from '@/hooks/useTransactionSearch';
import { getCached, setCached } from '@/lib/resourceCache';
import { getTodayYmd } from '@/lib/utils';
import {
  addMonths,
  daysInMonth,
  ymOf,
  analysisStartOf,
  normalizeLargeThreshold,
  normalizeStartYm,
  normalizeChartSpan,
} from '@/lib/spendingAnalysis';

// 這一頁的設定都存在 settings 跨裝置同步，不用另開資料表。value 欄不能是空值，所以都包成物件
export const LARGE_THRESHOLD_KEY = 'spending_analysis_large_threshold';
export const START_MONTH_KEY = 'spending_analysis_start_month';
export const CHART_SPAN_KEY = 'spending_analysis_chart_months';
const PREFS = {
  threshold: { key: LARGE_THRESHOLD_KEY, read: normalizeLargeThreshold, write: (v) => v },
  startYm: { key: START_MONTH_KEY, read: normalizeStartYm, write: (v) => ({ month: v }) },
  chartSpan: { key: CHART_SPAN_KEY, read: normalizeChartSpan, write: (v) => ({ months: v }) },
};
const readPrefs = (valueOf) => Object.fromEntries(Object.entries(PREFS).map(([name, p]) => [name, p.read(valueOf(p.key))]));

// 起點可以設得很早：一批 1000 筆分批讀（PostgREST 一次預設最多回這麼多），最多讀這麼多筆
export const ANALYSIS_FETCH_LIMIT = 20000;
const PAGE_SIZE = 1000;

// 切到別頁再回來時先用上次的資料畫，背景再重抓
const LEDGER_CACHE_KEY = 'spending-analysis:ledger';
const FIRST_MONTH_CACHE_KEY = 'spending-analysis:first-month';
const PREFS_CACHE_KEY = 'spending-analysis:prefs';

/** 已經讀到的資料是否涵蓋 from–to 這段 */
const covers = (ledger, fromYm, toYm) => !!ledger && ledger.fromYm <= fromYm && ledger.toYm >= toYm;

/**
 * 支出由新到舊分批讀。讀到上限就停：沒讀到的是最舊的部分，最舊那個月可能只讀到一半，
 * 從下一個月起才算完整（coveredFromYm），那個月以前的丟掉不算。
 */
async function fetchExpenses(userId, fromYm, toYm) {
  const rows = [];
  for (let from = 0; from < ANALYSIS_FETCH_LIMIT; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('transactions')
      .select(`${SELECT_COLUMNS}, subscription_id`)
      .eq('user_id', userId)
      .eq('type', 'expense')
      .gte('date', `${fromYm}-01`)
      .lte('date', `${toYm}-${daysInMonth(toYm)}`)
      .order('date', { ascending: false })
      .order('time', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    // subscriptionId：訂閱管理自動記的扣款，旅程提示不把它當成出國
    rows.push(...(data || []).map((row) => ({ ...mapSearchRow(row), subscriptionId: row.subscription_id ?? null })));
    if (!data || data.length < PAGE_SIZE) return { expenses: rows.reverse(), coveredFromYm: null };
  }
  const coveredFromYm = addMonths(ymOf(rows[rows.length - 1].date), 1);
  return { expenses: rows.filter((tx) => ymOf(tx.date) >= coveredFromYm).reverse(), coveredFromYm };
}

/**
 * 消費分析頁的資料：分析起點到這個月的支出、
 * 帳本第一筆交易的月份，以及這頁的設定（大額門檻、分析起點、長條圖月數）。計算交給 lib/spendingAnalysis.js。
 * 支出一次讀整段，換月份不用重讀；起點改早才要讀更早的部分。
 * 抓過的都記在記憶體（resourceCache，登出時清掉）：再回到這頁，先用記著的畫，背景重抓到了再換。
 */
export function useSpendingAnalysis(userId, year, month) {
  const targetYm = `${year}-${String(month).padStart(2, '0')}`;
  const [firstYm, setFirstYm] = useState(() => getCached(FIRST_MONTH_CACHE_KEY, userId));
  const [prefs, setPrefs] = useState(() => getCached(PREFS_CACHE_KEY, userId));
  const prefsRef = useRef(prefs);
  const storePrefs = useCallback((next) => {
    prefsRef.current = next;
    setPrefs(next);
    setCached(PREFS_CACHE_KEY, userId, next);
  }, [userId]);
  // 這次打開頁面改過的設定：背景讀回來的舊值不能把它蓋掉
  const changedRef = useRef(new Set());
  // 寫入排隊依序送出，後存的不會被先存、晚到的那次蓋掉
  const saveChainRef = useRef(Promise.resolve());
  const [ledger, setLedger] = useState(() => getCached(LEDGER_CACHE_KEY, userId));
  const [error, setError] = useState(null);
  // 第一筆交易月份、設定讀不到：照常算會講錯話（「還沒有紀錄」、用錯的起點算平常），當成載入失敗
  const [metaError, setMetaError] = useState(null);
  const requestIdRef = useRef(0);
  const refreshedRef = useRef(false);

  const ready = firstYm !== undefined && prefs !== undefined;
  const viewStart = ready ? analysisStartOf(firstYm, prefs.startYm) : null;
  const fetchFromYm = viewStart;
  const fetchToYm = ymOf(getTodayYmd());
  const ledgerReady = covers(ledger, fetchFromYm, fetchToYm);

  useEffect(() => {
    if (!userId || !fetchFromYm) return;
    // 起點改晚：讀過的已經涵蓋，這次打開頁面也重抓過了，就不再讀
    if (covers(getCached(LEDGER_CACHE_KEY, userId), fetchFromYm, fetchToYm) && refreshedRef.current) return;
    refreshedRef.current = true;
    const reqId = ++requestIdRef.current;
    setError(null);
    fetchExpenses(userId, fetchFromYm, fetchToYm)
      .then((result) => {
        if (reqId !== requestIdRef.current) return;
        const next = { fromYm: fetchFromYm, toYm: fetchToYm, ...result };
        setCached(LEDGER_CACHE_KEY, userId, next);
        setLedger(next);
      })
      .catch((err) => {
        // 有記著的資料就繼續顯示（畫面只在沒涵蓋時才看 error），背景重抓失敗不把整頁換成錯誤
        if (reqId === requestIdRef.current) setError(err);
      });
  }, [userId, fetchFromYm, fetchToYm]);

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
      .select('key, value')
      .eq('user_id', userId)
      .in('key', Object.values(PREFS).map((p) => p.key))
      .then(({ data, error: queryError }) => {
        if (cancelled) return;
        if (queryError) {
          if (prefsRef.current === undefined) setMetaError(queryError);
          return;
        }
        const stored = new Map((data || []).map((row) => [row.key, row.value]));
        const loaded = readPrefs((key) => stored.get(key));
        for (const name of changedRef.current) loaded[name] = prefsRef.current[name];
        storePrefs(loaded);
      });
    return () => { cancelled = true; };
  }, [userId, storePrefs]);

  /** 改設定（name 是 threshold／startYm／chartSpan）；畫面先變，寫入失敗再退回原本的值 */
  const savePref = useCallback((name, next) => {
    if (!userId || !prefsRef.current) return Promise.resolve();
    const previous = prefsRef.current[name];
    changedRef.current.add(name);
    storePrefs({ ...prefsRef.current, [name]: next });
    const run = saveChainRef.current.then(async () => {
      const { key, write } = PREFS[name];
      const { error: saveError } = await supabase
        .from('settings')
        .upsert({ user_id: userId, key, value: write(next) }, { onConflict: 'user_id,key' });
      if (saveError) {
        // 之後又存了別的就不退回，免得把較新的值蓋掉
        if (prefsRef.current[name] === next) storePrefs({ ...prefsRef.current, [name]: previous });
        throw saveError;
      }
    });
    saveChainRef.current = run.catch(() => {});
    return run;
  }, [userId, storePrefs]);

  const current = prefs ?? readPrefs(() => undefined);
  return {
    targetYm,
    expenses: ledgerReady ? ledger.expenses : [],
    firstYm,
    threshold: current.threshold,
    startYm: current.startYm,
    chartSpan: current.chartSpan,
    // 第一筆交易的月份、設定還沒查回來時也算載入中：避免先用錯的「平常」或預設門檻閃一下。
    // 沒有任何交易就不用讀支出；讀失敗就不算載入中，畫面才會改說載入失敗
    loading: !metaError && (!ready || (!!firstYm && !ledgerReady && !error)),
    error: (ledgerReady ? null : error) || metaError,
    // 交易筆數超過讀取上限時，資料從哪個月起才完整；沒超過是 null
    coveredFromYm: ledgerReady ? ledger.coveredFromYm : null,
    savePref,
  };
}
