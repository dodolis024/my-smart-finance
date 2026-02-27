import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { getTodayYmd, parseFormattedNumber } from '@/lib/utils';

export function useTransactions() {
  const [editingId, setEditingId] = useState(null);

  const submitTransaction = useCallback(async (formData, editId = null) => {
    const {
      date,
      itemName,
      categoryValue,
      paymentMethod,
      currency = 'TWD',
      amount: rawAmount,
      note,
    } = formData;

    if (!itemName || !rawAmount) throw new Error('請填寫項目名稱與金額！');
    if (!paymentMethod) throw new Error('請選擇支付方式！');

    const amountValue = parseFormattedNumber(String(rawAmount));
    const amount = parseFloat(amountValue);
    if (isNaN(amount) || amount <= 0) throw new Error('請輸入有效的金額！');

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
      const incomeCats = incomeCategories?.value || ['薪水', '投資'];
      type = Array.isArray(incomeCats) && incomeCats.includes(categoryValue) ? 'income' : 'expense';
      category = categoryValue;
    }

    const { data: exchangeRateVal, error: rateErr } = await supabase.rpc('get_exchange_rate', {
      p_currency: currency.trim().toUpperCase(),
    });

    const exchangeRate =
      rateErr == null && exchangeRateVal != null && exchangeRateVal > 0
        ? Number(exchangeRateVal)
        : 1.0;
    const twdAmount = Math.round(amount * exchangeRate * 100) / 100;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('請先登入');

    const { data: account } = await supabase
      .from('accounts')
      .select('id')
      .eq('name', paymentMethod)
      .single();

    const transactionData = {
      user_id: user.id,
      date,
      type,
      item_name: itemName,
      category,
      payment_method: paymentMethod,
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
        await supabase.from('checkins').upsert(
          { user_id: user.id, date: today, source: 'onTimeTransaction' },
          { onConflict: 'user_id,date' }
        );
      }
    }

    return { date, isEdit: !!editId };
  }, []);

  const deleteTransaction = useCallback(async (id) => {
    const { error } = await supabase.from('transactions').delete().eq('id', id);
    if (error) throw error;
  }, []);

  return {
    editingId,
    setEditingId,
    submitTransaction,
    deleteTransaction,
  };
}
