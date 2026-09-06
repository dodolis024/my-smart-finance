import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * 某一年有交易紀錄的月份（1–12），供期間選擇器把沒消費的月份淡化。
 *
 * 只取 date 欄位，一年幾百列的傳輸量很小；同一位使用者的同一年整個 session 只查一次，
 * 記帳／改帳／刪帳後由呼叫端 invalidate。查詢失敗回 null——所有月份維持原樣，
 * 寧可不提示，也不要用淡化誤導使用者以為那個月沒紀錄。
 */

// PostgREST 單次回傳上限；正常一年不會超過，超過就翻頁補齊
const PAGE_SIZE = 1000;
const cache = new Map(); // `${userId}:${year}` → Set<number>
const listeners = new Set();

export function invalidateTransactionMonths(userId) {
  if (!userId) return;
  [...cache.keys()].forEach((k) => { if (k.startsWith(`${userId}:`)) cache.delete(k); });
  listeners.forEach((l) => l());
}

export function useTransactionMonthsInYear(userId, year) {
  const key = userId && year ? `${userId}:${year}` : null;
  const [months, setMonths] = useState(() => (key ? cache.get(key) ?? null : null));
  const [tick, setTick] = useState(0);

  // 記帳後快取作廢，開著的選擇器要跟著重查
  useEffect(() => {
    const listener = () => setTick((n) => n + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  useEffect(() => {
    if (!key) {
      setMonths(null);
      return;
    }
    const cached = cache.get(key);
    if (cached) {
      setMonths(cached);
      return;
    }

    let cancelled = false;
    setMonths(null);
    (async () => {
      const found = new Set();
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
          .from('transactions')
          .select('date')
          .eq('user_id', userId)
          .gte('date', `${year}-01-01`)
          .lte('date', `${year}-12-31`)
          .order('date', { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (error) return;
        (data || []).forEach((row) => found.add(Number(String(row.date).slice(5, 7))));
        // 12 個月都湊齊就不必再翻
        if (found.size === 12 || (data || []).length < PAGE_SIZE) break;
      }
      cache.set(key, found);
      if (!cancelled) setMonths(found);
    })().catch((err) => console.error('[Dashboard] fetch months with data failed:', err));

    return () => { cancelled = true; };
  }, [key, userId, year, tick]);

  return months;
}
