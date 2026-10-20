import { useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { useCachedResource } from '@/hooks/useCachedResource';
import { notifyDataChanged } from '@/lib/dataEvents';
import { taipeiClock, chargeDateToday } from '@/lib/subscriptionSchedule';

export function useSubscriptions() {
  const { user } = useAuth();
  const { t } = useLanguage();

  const {
    data: subscriptions,
    setData: setSubscriptions,
    loading,
    load: loadSubscriptions,
  } = useCachedResource('subscriptions', {
    userId: user?.id,
    initial: [],
    fetcher: async () => {
      const { data, error } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  const saveSubscription = useCallback(async (formData, id = null) => {
    if (!user) return;
    // 月繳時清空 renewal_month，避免切換週期後殘留舊值
    const payload = {
      ...formData,
      renewal_month: formData.billing_cycle === 'yearly' ? formData.renewal_month : null,
      user_id: user.id,
    };
    let transactionCreated = false;

    if (id) {
      const { error } = await supabase.from('subscriptions').update(payload).eq('id', id);
      if (error) throw error;
    } else {
      // 新增：取得新訂閱的 id 以便後續建立交易
      const { data: inserted, error } = await supabase
        .from('subscriptions')
        .insert(payload)
        .select('id')
        .single();
      if (error) throw error;

      // 若今天剛好是扣款日，立刻建立交易。
      // 「今天」與月底夾法和 process-subscriptions 排程共用同一套規則（lib/subscriptionSchedule.js），
      // 以台灣時間判斷，裝置時區不同時兩端才不會各說各話（最壞情況兩邊都不建立交易）
      const clock = taipeiClock(new Date());
      const dateStr = chargeDateToday(formData, clock);

      if (dateStr) {
        // time 與日期用同一個台灣時鐘；不帶的話資料庫會用它自己的 UTC 時鐘，慢 8 小時
        const timeStr = clock.time;

        // 查無匯率時不建立當日交易（訂閱本身照常保留），避免外幣被靜默以 1:1 記成錯誤的台幣金額
        let exchangeRate = 1;
        if (formData.currency && formData.currency !== 'TWD') {
          const { data: rateVal, error: rateErr } = await supabase.rpc('get_exchange_rate', {
            p_currency: formData.currency.toUpperCase(),
          });
          if (rateErr || rateVal == null || Number(rateVal) <= 0) {
            await loadSubscriptions();
            return { transactionCreated: false, rateUnavailable: true };
          }
          exchangeRate = Number(rateVal);
        }
        const twdAmount = Math.round(formData.amount * exchangeRate * 100) / 100;

        let accountId = null;
        if (formData.payment_method) {
          const { data: account } = await supabase
            .from('accounts')
            .select('id')
            .eq('name', formData.payment_method)
            .eq('user_id', user.id)
            .single();
          accountId = account?.id || null;
        }

        const { error: txError } = await supabase.from('transactions').insert({
          user_id: user.id,
          date: dateStr,
          time: timeStr,
          type: 'expense',
          item_name: formData.name,
          category: formData.category || t('transaction.other'),
          payment_method: formData.payment_method || null,
          account_id: accountId,
          currency: formData.currency || 'TWD',
          amount: formData.amount,
          exchange_rate: exchangeRate,
          twd_amount: twdAmount,
          subscription_id: inserted.id,
        });

        if (txError) {
          // 訂閱本身已經存好，不能整個報失敗；但這筆扣款也不能就此無聲消失——
          // 排程只在到期日當天跑一次，錯過了不會回頭補，使用者得知道要手動記
          console.error('[useSubscriptions] create due-today transaction failed:', txError.message);
          await loadSubscriptions();
          return { transactionCreated: false, transactionFailed: true };
        }

        transactionCreated = true;
        // 通知已掛載的儀表板重抓當月資料，否則設定面板疊在儀表板上，
        // 關閉後要手動刷新才看得到這筆當日扣款
        notifyDataChanged();
      }
    }

    await loadSubscriptions();
    return { transactionCreated };
  }, [user, loadSubscriptions, t]);

  const deleteSubscription = useCallback(async (id) => {
    const { error } = await supabase.from('subscriptions').delete().eq('id', id);
    if (error) throw error;
    await loadSubscriptions();
  }, [loadSubscriptions]);

  const toggleSubscription = useCallback(async (id, isActive) => {
    const { error } = await supabase
      .from('subscriptions')
      .update({ is_active: isActive })
      .eq('id', id);
    if (error) throw error;
    setSubscriptions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, is_active: isActive } : s))
    );
  }, [setSubscriptions]);

  return {
    subscriptions,
    loading,
    loadSubscriptions,
    saveSubscription,
    deleteSubscription,
    toggleSubscription,
  };
}
