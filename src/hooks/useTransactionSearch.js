import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_LIMIT = 200;
const SEARCH_COLUMNS = ['item_name', 'category', 'note', 'payment_method'];

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
    type: row.type,
    category: row.category,
    itemName: row.item_name,
    paymentMethod: row.payment_method,
    currency: row.currency,
    originalAmount: row.amount == null ? null : Number(row.amount),
    exchangeRate: row.exchange_rate == null ? null : Number(row.exchange_rate),
    twdAmount: row.twd_amount == null ? 0 : Number(row.twd_amount),
    note: row.note,
    // isSplitSynced 刻意不帶：resolveSplitSynced / TransactionDetail 會自查 split_ledger_syncs
  };
}

/**
 * 跨月交易搜尋（伺服器端 ilike，上限 200 筆，日期新→舊）。
 * debounce 300ms；requestIdRef 防過期回應（仿 useDashboard.js:83）。
 */
export function useTransactionSearch(userId, query) {
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const requestIdRef = useRef(0);

  const runSearch = useCallback(
    async (rawQuery) => {
      const reqId = ++requestIdRef.current;
      const sanitized = sanitizeSearchQuery(rawQuery);
      if (!userId || !sanitized) {
        setResults([]);
        setSearching(false);
        setSearchError(null);
        return;
      }
      setSearching(true);
      setSearchError(null);
      const pattern = `%${sanitized}%`;
      const orExpr = SEARCH_COLUMNS.map((c) => `${c}.ilike.${pattern}`).join(',');
      const { data, error } = await supabase
        .from('transactions')
        .select(
          'id, date, type, item_name, category, payment_method, currency, amount, exchange_rate, twd_amount, note'
        )
        .eq('user_id', userId)
        .or(orExpr)
        .order('date', { ascending: false })
        .limit(SEARCH_LIMIT);

      if (reqId !== requestIdRef.current) return;
      setSearching(false);
      if (error) {
        setSearchError(error.message || 'search failed');
        setResults([]);
        return;
      }
      setResults((data || []).map(mapSearchRow));
    },
    [userId]
  );

  useEffect(() => {
    if (!query || !query.trim()) {
      // 作廢在途請求，立即清空
      requestIdRef.current++;
      setResults([]);
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

  return { results, searching, searchError, refresh };
}
