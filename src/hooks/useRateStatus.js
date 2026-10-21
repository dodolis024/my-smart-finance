import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { ratesStale, daysSinceRateUpdate, scheduleAtNextRateUpdate } from '@/lib/rateFreshness';

// 資料庫匯率表中最久沒更新的幣別是什麼時候更新的，全站共用（非個資），模組層級快取：
// 一次頁面載入只查一次，資料庫排程更新過之後再查一次。
// 用途只有一個：排程壞掉太久時在首頁提示。之前 cron 網址錯了 53 天沒人發現，
// 期間所有外幣記帳都用停擺前的匯率。
let cache = { updatedAt: null, fetchedAt: 0 };
let inflight = null;
const listeners = new Set();

function notify() {
  listeners.forEach((fn) => fn(cache));
}

async function fetchStatus() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      // 取「最久沒更新」的那個幣別，不是最新的那個：update-exchange-rates 每天一定會寫 TWD，
      // 看最新的永遠是今天。被 ±20% 防呆拒絕的幣別不寫、updated_at 留在原值（見該函式的
      // validate.ts），連續被拒到門檻天數，這裡就會亮——這是防呆卡住某個幣別時唯一的告警。
      const { data, error } = await supabase
        .from('exchange_rates')
        .select('updated_at')
        .order('updated_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      cache = { updatedAt: data?.updated_at ?? null, fetchedAt: Date.now() };
      notify();
    } catch {
      // 離線或查詢失敗：沒有資訊就不提示，下次進來再查（fetchedAt 不更新）
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** 資料庫的匯率距今幾天沒更新；還沒查到或查不到時回 null */
export function useRateStatus() {
  const [status, setStatus] = useState(cache);

  useEffect(() => {
    listeners.add(setStatus);
    if (ratesStale(cache.fetchedAt)) fetchStatus();
    // 整天開著沒切走時，在下一次排程更新後再查一次
    const cancel = scheduleAtNextRateUpdate(() => { if (ratesStale(cache.fetchedAt)) fetchStatus(); });
    return () => {
      listeners.delete(setStatus);
      cancel();
    };
  }, []);

  return { updatedAt: status.updatedAt, staleDays: daysSinceRateUpdate(status.updatedAt) };
}

/** 測試用：清掉模組快取 */
export function _resetRateStatusCache() {
  cache = { updatedAt: null, fetchedAt: 0 };
  inflight = null;
}
