import { useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { calculateCreditUsage } from '@/lib/creditCard';

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
    if (!account.credit_limit || account.credit_limit <= 0) return;

    // 內部 async 邏輯以 IIFE 包裹，fire-and-forget，錯誤不冒泡至呼叫端
    (async () => {
      try {
        const billingDay = account.billing_day || account.billingDay;
        if (!billingDay) return;

        // 計算需要查詢的日期範圍（同 fetchCreditHistory 邏輯）
        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth() + 1;
        const currentDay = today.getDate();
        const pad = (n) => String(n).padStart(2, '0');

        let lastBillingYear = currentYear;
        let lastBillingMonth = currentMonth;
        if (currentDay < billingDay) {
          lastBillingMonth -= 1;
          if (lastBillingMonth < 1) { lastBillingMonth = 12; lastBillingYear -= 1; }
        }
        let prevBillingYear = lastBillingYear;
        let prevBillingMonth = lastBillingMonth - 1;
        if (prevBillingMonth < 1) { prevBillingMonth = 12; prevBillingYear -= 1; }

        const fromDate = `${prevBillingYear}-${pad(prevBillingMonth)}-${pad(billingDay)}`;
        const toDate = `${currentYear}-${pad(currentMonth)}-${pad(currentDay)}`;

        const { data, error } = await supabase
          .from('transactions')
          .select('id, type, date, account_id, payment_method, twd_amount')
          .gte('date', fromDate)
          .lte('date', toDate);

        if (error) return;

        const history = (data || []).map((tx) => ({
          ...tx,
          paymentMethod: tx.payment_method,
          twdAmount: tx.twd_amount,
        }));

        const used = calculateCreditUsage(account, history);
        const usageRate = used / account.credit_limit;

        supabase.functions.invoke('send-credit-usage-alert', {
          body: {
            user_id: user.id,
            account_id: account.id,
            account_name: account.name,
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
