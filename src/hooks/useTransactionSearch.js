import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

const SEARCH_DEBOUNCE_MS = 300;
export const SEARCH_LIMIT = 200;
// 區間查詢的明確筆數上限：行為由我們定義，而不是由 Supabase 專案的預設值決定（避免靜默截斷）
export const RANGE_FETCH_LIMIT = 5000;
const EMPTY_SUMMARY = { totalIncome: 0, totalExpense: 0, balance: 0 };

/** 加總一批交易的 TWD 收入/支出/結餘（結餘 = 收入 − 支出），與 get_dashboard_data 的彙總同義。 */
export function sumTransactions(rows) {
  return (rows || []).reduce(
    (acc, tx) => {
      const amt = typeof tx.twdAmount === 'number' ? tx.twdAmount : 0;
      if (tx.type === 'income') {
        acc.totalIncome += amt;
        acc.balance += amt;
      } else {
        acc.totalExpense += amt;
        acc.balance -= amt;
      }
      return acc;
    },
    { totalIncome: 0, totalExpense: 0, balance: 0 }
  );
}
const SEARCH_COLUMNS = ['item_name', 'category', 'note', 'payment_method'];
// 兩個查詢（跨月搜尋 / 自訂區間匯出）共用同一份欄位定義，避免日後漂移
export const SELECT_COLUMNS = 'id, date, time, type, item_name, category, payment_method, currency, amount, exchange_rate, twd_amount, overseas_fee_rate, overseas_fee, note';

/**
 * 消毒搜尋字（export 供測試直接驗）：
 * 1. PostgREST or() 的保留字元 , ( ) " 與跳脫用反斜線 → 以空白取代（避免注入額外條件或壞掉語法）
 * 2. LIKE 萬用字元 % _ → 反斜線跳脫（讓使用者搜得到字面值）
 */
export function sanitizeSearchQuery(raw) {
  return String(raw || '')
    .replace(/[,()"\\]/g, ' ')
    .trim()
    .replace(/[%_]/g, (m) => '\\' + m);
}

/** 直查表回傳蛇形欄位；統一映射成 RPC 的駝峰形狀（見 supabase-functions.sql:91-105）。 */
export function mapSearchRow(row) {
  return {
    id: row.id,
    date: row.date,
    time: row.time,
    type: row.type,
    category: row.category,
    itemName: row.item_name,
    paymentMethod: row.payment_method,
    currency: row.currency,
    originalAmount: row.amount == null ? null : Number(row.amount),
    exchangeRate: row.exchange_rate == null ? null : Number(row.exchange_rate),
    twdAmount: row.twd_amount == null ? 0 : Number(row.twd_amount),
    overseasFeeRate: row.overseas_fee_rate == null ? null : Number(row.overseas_fee_rate),
    overseasFee: row.overseas_fee == null ? null : Number(row.overseas_fee),
    note: row.note,
    // isSplitSynced 刻意不帶：resolveSplitSynced / TransactionDetail 會自查 split_ledger_syncs
  };
}

/**
 * 跨月交易搜尋的共用查詢邏輯（供 hook 內部與 CSV 完整匯出共用，避免兩邊查詢條件漂移）。
 * @param {string} userId
 * @param {string} rawQuery 未消毒的搜尋字
 * @param {{ limit?: number, count?: boolean }} [options] limit 為 null/undefined 時不限筆數；count 為 true 時向 PostgREST 要精確總數
 * @returns {Promise<{ rows: object[], count: number, error: object|null }>}
 */
export async function fetchTransactionMatches(userId, rawQuery, { limit, count = false } = {}) {
  const sanitized = sanitizeSearchQuery(rawQuery);
  if (!userId || !sanitized) {
    return { rows: [], count: 0, error: null };
  }
  const pattern = `%${sanitized}%`;
  const orExpr = SEARCH_COLUMNS.map((c) => `${c}.ilike.${pattern}`).join(',');
  let queryBuilder = supabase
    .from('transactions')
    .select(SELECT_COLUMNS, count ? { count: 'exact' } : undefined)
    .eq('user_id', userId)
    .or(orExpr)
    .order('date', { ascending: false })
    .order('time', { ascending: false });
  if (limit != null) {
    queryBuilder = queryBuilder.limit(limit);
  }
  const { data, count: total, error } = await queryBuilder;
  const rows = (data || []).map(mapSearchRow);
  return { rows, count: total ?? rows.length, error };
}

/**
 * 消費分析的旅程明細「加入日期範圍外的交易」：分類、關鍵字可以單用或一起用。
 * 只選分類不打字時，列出出發日之前的（離出發日最近的在前），找出發前訂的機票、飯店；
 * 有打字就跟一般搜尋一樣不限日期。只查支出。
 * @param {string} userId
 * @param {{ query?: string, category?: string, before: string, limit?: number }} options before 為出發日 'YYYY-MM-DD'
 */
export async function fetchTripAddCandidates(userId, { query, category, before, limit }) {
  const sanitized = sanitizeSearchQuery(query);
  if (!userId || (!sanitized && !category)) {
    return { rows: [], error: null };
  }
  let queryBuilder = supabase
    .from('transactions')
    .select(SELECT_COLUMNS)
    .eq('user_id', userId)
    .neq('type', 'income');
  if (category) queryBuilder = queryBuilder.eq('category', category);
  if (sanitized) {
    const pattern = `%${sanitized}%`;
    queryBuilder = queryBuilder.or(SEARCH_COLUMNS.map((c) => `${c}.ilike.${pattern}`).join(','));
  } else {
    queryBuilder = queryBuilder.lt('date', before);
  }
  queryBuilder = queryBuilder.order('date', { ascending: false }).order('time', { ascending: false });
  if (limit != null) queryBuilder = queryBuilder.limit(limit);
  const { data, error } = await queryBuilder;
  return { rows: (data || []).map(mapSearchRow), error };
}

// 分帳同步紀錄一次讀這麼多筆（PostgREST 一次預設最多回這麼多）
const SPLIT_SYNC_PAGE_SIZE = 1000;

/**
 * 從分帳群組同步到帳本的交易，現在各掛著哪些分類（去掉重複）。
 * 同步時分類寫的是群組名稱，不在使用者自己的分類清單裡；旅程明細的分類選單靠這個把它們補上。
 * 看的是交易現在的分類：群組改過名、或使用者在帳本改過分類，選單裡的名字都還搜得到交易。
 * @param {string} userId
 * @returns {Promise<{ categories: string[], error: object|null }>}
 */
export async function fetchSplitSyncedCategories(userId) {
  const names = new Set();
  if (!userId) return { categories: [], error: null };
  for (let from = 0; ; from += SPLIT_SYNC_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('split_ledger_syncs')
      .select('id, transaction:transactions(category)')
      .eq('user_id', userId)
      .order('id')
      .range(from, from + SPLIT_SYNC_PAGE_SIZE - 1);
    if (error) return { categories: [], error };
    for (const row of data || []) {
      const name = row.transaction?.category?.trim();
      if (name) names.add(name);
    }
    if (!data || data.length < SPLIT_SYNC_PAGE_SIZE) break;
  }
  return { categories: [...names], error: null };
}

/**
 * 依日期區間（含端點）查詢交易，供「自訂區間匯出 CSV」與主畫面年檢視使用。
 * 日期舊→新排序（匯出的 CSV 順序依賴這個排序，年檢視在呼叫端自行排成新→舊），
 * 與跨月搜尋共用同一份欄位定義（SELECT_COLUMNS）。
 * @param {string} userId
 * @param {string} startDate 'YYYY-MM-DD'
 * @param {string} endDate 'YYYY-MM-DD'
 * @param {{ limit?: number, count?: boolean }} [options] limit 為 null/undefined 時不限筆數；count 為 true 時向 PostgREST 要精確總數
 * @returns {Promise<{ rows: object[], count: number, error: object|null }>}
 */
export async function fetchTransactionsByDateRange(userId, startDate, endDate, { limit, count = false } = {}) {
  if (!userId || !startDate || !endDate) {
    return { rows: [], count: 0, error: null };
  }
  let queryBuilder = supabase
    .from('transactions')
    .select(SELECT_COLUMNS, count ? { count: 'exact' } : undefined)
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true })
    .order('time', { ascending: true });
  if (limit != null) {
    queryBuilder = queryBuilder.limit(limit);
  }
  const { data, count: total, error } = await queryBuilder;
  const rows = (data || []).map(mapSearchRow);
  return { rows, count: total ?? rows.length, error };
}

/**
 * 跨月交易搜尋（伺服器端 ilike，上限 200 筆，日期新→舊）。
 * debounce 300ms；requestIdRef 防過期回應（仿 useDashboard.js:83）。
 */
export function useTransactionSearch(userId, query) {
  const [results, setResults] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  // 加總所用的「全部符合」列（可能多於畫面上的 200 筆），顯示幣別不是台幣時由呼叫端自行換算加總
  const [allMatches, setAllMatches] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const requestIdRef = useRef(0);

  const runSearch = useCallback(
    async (rawQuery) => {
      const reqId = ++requestIdRef.current;
      const sanitized = sanitizeSearchQuery(rawQuery);
      if (!userId || !sanitized) {
        setResults([]);
        setTotalCount(0);
        setSummary(EMPTY_SUMMARY);
        setAllMatches([]);
        setSearching(false);
        setSearchError(null);
        return;
      }
      setSearching(true);
      setSearchError(null);
      const { rows, count, error } = await fetchTransactionMatches(userId, rawQuery, {
        limit: SEARCH_LIMIT,
        count: true,
      });

      if (reqId !== requestIdRef.current) return;
      if (error) {
        setSearching(false);
        setSearchError(error.message || 'search failed');
        setResults([]);
        setTotalCount(0);
        setSummary(EMPTY_SUMMARY);
        setAllMatches([]);
        return;
      }

      // 三個總結數字要涵蓋「全部符合」的交易，而非畫面上限的 200 筆。
      // 命中數超過上限時，另抓齊全部符合的列再加總（與匯出共用同一查詢，保證總額與清單一致）。
      let summaryRows = rows;
      if (count > rows.length) {
        const { rows: allRows, error: allError } = await fetchTransactionMatches(userId, rawQuery, {
          limit: count,
        });
        if (reqId !== requestIdRef.current) return;
        if (!allError) summaryRows = allRows;
      }

      // 清單與總額一併更新，避免「清單已換、數字還停在前一筆」的閃爍
      setResults(rows);
      setTotalCount(count);
      setSummary(sumTransactions(summaryRows));
      setAllMatches(summaryRows);
      setSearching(false);
    },
    [userId]
  );

  useEffect(() => {
    if (!query || !query.trim()) {
      // 作廢在途請求，立即清空
      requestIdRef.current++;
      setResults([]);
      setTotalCount(0);
      setSummary(EMPTY_SUMMARY);
      setAllMatches([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    // 有輸入就立刻進 loading 態，避免 debounce 空窗期先閃出「0 筆／無結果」
    setSearching(true);
    const timer = setTimeout(() => {
      runSearch(query);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  // 刪除/編輯成功後讓搜尋結果同步；query 為空時安全 no-op
  const refresh = useCallback(() => {
    if (query && query.trim()) runSearch(query);
  }, [query, runSearch]);

  return { results, totalCount, summary, summaryRows: allMatches, searching, searchError, refresh };
}
