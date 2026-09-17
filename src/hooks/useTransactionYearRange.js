import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * 使用者最早／最新一筆交易的年份，供期間選擇器把範圍外的年份淡化停用。
 *
 * 用兩個只取一列的極輕量查詢換掉「回傳 distinct 年份」的資料庫函式（免 migration）。
 * 已知限制：範圍「內」的空白年份不會被淡化。
 * 同一位使用者整個 session 只查一次，結果放模組層快取；記帳／改帳／刪帳後由呼叫端 invalidate
 * （新年第一筆帳記完，今年才會進到範圍裡）。
 */
let cachedRange = null; // { userId, range }
const listeners = new Set();

export function invalidateTransactionYearRange(userId) {
  if (!userId) return;
  if (cachedRange?.userId === userId) cachedRange = null;
  // 快取還沒寫入（首次查詢在路上）也要通知：那次查詢可能早於這筆寫入，重查才準
  listeners.forEach((l) => l());
}

export function useTransactionYearRange(userId) {
  const [yearRange, setYearRange] = useState(
    () => (cachedRange && cachedRange.userId === userId ? cachedRange.range : null)
  );
  const [tick, setTick] = useState(0);

  // 快取作廢後，已掛載的頁面要跟著重查
  useEffect(() => {
    const listener = () => setTick((n) => n + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  useEffect(() => {
    if (!userId) {
      setYearRange(null);
      return;
    }
    if (cachedRange && cachedRange.userId === userId) {
      setYearRange(cachedRange.range);
      return;
    }

    let cancelled = false;
    Promise.all([
      supabase.from('transactions').select('date').eq('user_id', userId)
        .order('date', { ascending: true }).limit(1),
      supabase.from('transactions').select('date').eq('user_id', userId)
        .order('date', { ascending: false }).limit(1),
    ])
      .then(([first, last]) => {
        if (cancelled) return;
        // 查詢失敗（含斷線）就維持原值：重查失敗不該把已知範圍洗掉，首次失敗則是 null（所有年份可選）
        if (first.error || last.error) return;
        const minDate = first.data?.[0]?.date;
        const maxDate = last.data?.[0]?.date;
        const range = minDate && maxDate
          ? { minYear: Number(String(minDate).slice(0, 4)), maxYear: Number(String(maxDate).slice(0, 4)) }
          : null;
        cachedRange = { userId, range };
        setYearRange(range);
      })
      .catch((err) => console.error('[Dashboard] fetch transaction year range failed:', err));

    return () => { cancelled = true; };
  }, [userId, tick]);

  return yearRange;
}
