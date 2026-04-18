import { useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { getTodayYmd, parseFormattedNumber } from '@/lib/utils';

export function useTransactions() {
  const { user } = useAuth();
  const { t } = useLanguage();

  const submitTransaction = useCallback(async (formData, editId = null, options = {}) => {
    const { isSplitSynced = false } = options;
    const {
      date,
      itemName,
      categoryValue,
      paymentMethod,
      currency = 'TWD',
      amount: rawAmount,
      note,
    } = formData;

    const paymentTrimmed = String(paymentMethod || '').trim();
    const allowEmptyPayment = Boolean(editId && isSplitSynced && !paymentTrimmed);

    if (!itemName || !rawAmount) throw new Error(t('transaction.requiredFields'));
    if (!allowEmptyPayment && !paymentTrimmed) throw new Error(t('transaction.selectPayment'));
    if (!date) throw new Error(t('transaction.selectDate'));

    const amountValue = parseFormattedNumber(String(rawAmount));
    const amount = parseFloat(amountValue);
    if (isNaN(amount) || amount <= 0) throw new Error(t('transaction.invalidAmount'));

    let type, category;
    if (categoryValue.startsWith('expense:')) {
      type = 'expense';
      category = categoryValue.slice(8);
    } else if (categoryValue.startsWith('income:')) {
      type = 'income';
      category = categoryValue.slice(7);
    } else {
      const { data: incomeCategories } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'income_categories')
        .single();
      const incomeCats = incomeCategories?.value || ['薪水', '投資', 'Salary', 'Investment'];
      type = Array.isArray(incomeCats) && incomeCats.includes(categoryValue) ? 'income' : 'expense';
      category = categoryValue;
    }

    if (!user) throw new Error(t('auth.loginRequired'));

    const { data: exchangeRateVal, error: rateErr } = await supabase.rpc('get_exchange_rate', {
      p_currency: currency.trim().toUpperCase(),
    });

    let account = null;
    if (paymentTrimmed) {
      const { data: acc } = await supabase.from('accounts').select('id').eq('name', paymentTrimmed).maybeSingle();
      account = acc;
    }

    const exchangeRate =
      rateErr === null && exchangeRateVal != null && exchangeRateVal > 0
        ? Number(exchangeRateVal)
        : 1.0;
    const twdAmount = Math.round(amount * exchangeRate * 100) / 100;

    const transactionData = {
      user_id: user.id,
      date,
      type,
      item_name: itemName,
      category,
      payment_method: paymentTrimmed || null,
      account_id: account?.id || null,
      currency: currency.toUpperCase(),
      amount,
      exchange_rate: exchangeRate,
      twd_amount: twdAmount,
      note: note || null,
    };

    if (editId) {
      const { error } = await supabase.from('transactions').update(transactionData).eq('id', editId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('transactions').insert(transactionData);
      if (error) throw error;

      const today = getTodayYmd();
      if (date === today) {
        const { error: checkinError } = await supabase.from('checkins').upsert(
          { user_id: user.id, date: today, source: 'onTimeTransaction' },
          { onConflict: 'user_id,date' }
        );
        // checkin failure is non-critical, silently ignore
      }
    }

    return { date, isEdit: !!editId };
  }, [user, t]);

  const deleteTransaction = useCallback(async (id) => {
    const { error } = await supabase.from('transactions').delete().eq('id', id);
    if (error) throw error;
  }, []);

  return {
    submitTransaction,
    deleteTransaction,
  };
}
