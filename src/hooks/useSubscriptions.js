import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';

// Module-level cache
let cachedSubscriptions = null;
let cachedUserId = null;

export function useSubscriptions() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [subscriptions, setSubscriptions] = useState(() =>
    (cachedSubscriptions && cachedUserId === user?.id) ? cachedSubscriptions : []
  );
  const [loading, setLoading] = useState(() =>
    !(cachedSubscriptions && cachedUserId === user?.id)
  );

  useEffect(() => {
    cachedSubscriptions = subscriptions;
    cachedUserId = user?.id ?? null;
  }, [subscriptions, user?.id]);

  const loadSubscriptions = useCallback(async () => {
    if (!user) return;
    if (!cachedSubscriptions || cachedUserId !== user.id) setLoading(true);
    try {
      const { data, error } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setSubscriptions(data || []);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const saveSubscription = useCallback(async (formData, id = null) => {
    if (!user) return;
    const payload = { ...formData, user_id: user.id };
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
      const today = new Date();
      const year = today.getFullYear();
      const month = today.getMonth() + 1;
      const todayDay = today.getDate();
      const actualDay = Math.min(formData.renewal_day, new Date(year, month, 0).getDate());

      if (todayDay === actualDay) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(todayDay).padStart(2, '0')}`;

        let exchangeRate = 1;
        if (formData.currency && formData.currency !== 'TWD') {
          const { data: rateVal } = await supabase.rpc('get_exchange_rate', {
            p_currency: formData.currency.toUpperCase(),
          });
          if (rateVal && rateVal > 0) exchangeRate = Number(rateVal);
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

        if (!txError) transactionCreated = true;
      }
    }

    await loadSubscriptions();
    return { transactionCreated };
  }, [user, loadSubscriptions]);

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
  }, []);

  return {
    subscriptions,
    loading,
    loadSubscriptions,
    saveSubscription,
    deleteSubscription,
    toggleSubscription,
  };
}
