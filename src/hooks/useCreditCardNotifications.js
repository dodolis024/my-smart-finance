import { useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { calculateCreditUsage, getBillingCycleRange } from '@/lib/creditCard';

/**
 * 信用卡通知 Hook
 * 提供 checkCreditUsageAlert(account) — fire-and-forget
 * 在交易新增/更新/刪除後呼叫，若使用率超過閾值則推播警告
 */
export function useCreditCardNotifications() {
  const { user } = useAuth();

  const checkCreditUsageAlert = useCallback((account) => {
    if (!user) return;
    if (!account || account.type !== 'credit_card') return;
    // 帳戶資料可能來自 RPC（駝峰）或資料表（蛇形），兩種欄位名都要支援
    const creditLimit = account.credit_limit ?? account.creditLimit;
    if (!creditLimit || creditLimit <= 0) return;

    // 內部 async 邏輯以 IIFE 包裹，fire-and-forget，錯誤不冒泡至呼叫端
    (async () => {
      try {
        const cycle = getBillingCycleRange(account);
        if (!cycle) return;

        const { data, error } = await supabase
          .from('transactions')
          .select('id, type, date, account_id, payment_method, twd_amount')
          .gte('date', cycle.prevBillingDate)
          .lte('date', cycle.todayDate);

        if (error) return;

        const history = (data || []).map((tx) => ({
          ...tx,
          paymentMethod: tx.payment_method,
          twdAmount: tx.twd_amount,
        }));

        const used = calculateCreditUsage(account, history);
        const usageRate = used / creditLimit;

        // user_id／account_name 由 edge function 端以 JWT 與資料庫查詢為準（不信任 body），
        // 這裡不再傳送這兩個欄位
        supabase.functions.invoke('send-credit-usage-alert', {
          body: {
            account_id: account.id,
            usage_rate: usageRate,
          },
        }).catch(() => {});
      } catch {
        // 非關鍵操作，靜默忽略錯誤
      }
    })();
  }, [user]);

  return { checkCreditUsageAlert };
}
