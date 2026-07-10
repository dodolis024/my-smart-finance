import { useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { useCachedResource } from '@/hooks/useCachedResource';
import { notifyTransactionsChanged } from '@/lib/transactionEvents';

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

      // 若今天剛好是扣款日，立刻建立交易
      // 與 process-subscriptions edge function 同樣以台灣時間(UTC+8)判斷「今天」,
      // 避免裝置時區不同時兩端判定不一致(最壞情況兩邊都不建立交易)
      const tw = new Date(Date.now() + 8 * 60 * 60 * 1000);
      const year = tw.getUTCFullYear();
      const month = tw.getUTCMonth() + 1;
      const todayDay = tw.getUTCDate();

      const cycle = formData.billing_cycle || 'monthly';
      let isDueToday = false;
      if (cycle === 'yearly') {
        // 年繳：需月份相符且日相符（月底自動調整）
        if (month === formData.renewal_month) {
          const actualDay = Math.min(formData.renewal_day, new Date(year, month, 0).getDate());
          isDueToday = todayDay === actualDay;
        }
      } else {
        const actualDay = Math.min(formData.renewal_day, new Date(year, month, 0).getDate());
        isDueToday = todayDay === actualDay;
      }

      if (isDueToday) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(todayDay).padStart(2, '0')}`;

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

        if (!txError) {
          transactionCreated = true;
          // 通知已掛載的儀表板重抓當月資料，否則設定面板疊在儀表板上，
          // 關閉後要手動刷新才看得到這筆當日扣款
          notifyTransactionsChanged();
        }
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
