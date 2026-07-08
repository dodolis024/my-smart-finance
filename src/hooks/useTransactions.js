import { useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { getTodayYmd, parseFormattedNumber } from '@/lib/utils';
import { loadRates, loadAccounts, isOfflineError } from '@/lib/offlineCache';
import { enqueueTransaction } from '@/lib/offlineQueue';

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

    const normalizedCurrency = currency.trim().toUpperCase();

    // 離線入列(僅新增):以本地快取解析匯率與帳戶,組出完整 insert payload 暫存,
    // 恢復連線後由 offlineQueue 補送;客戶端自帶 UUID 確保重試不會重複記帳
    const queueOffline = (resolvedRate = null) => {
      let offlineRate = resolvedRate;
      if (offlineRate == null) {
        if (normalizedCurrency === 'TWD') {
          offlineRate = 1.0;
        } else {
          const cachedRate = Number(loadRates()?.[normalizedCurrency]);
          // 快取也沒有匯率時比照線上行為擋下,避免外幣被錯記
          if (!(cachedRate > 0)) {
            throw new Error(t('transaction.rateUnavailable', { currency: normalizedCurrency }));
          }
          offlineRate = cachedRate;
        }
      }
      const cachedAccount = paymentTrimmed
        ? loadAccounts(user.id).find((a) => (a.accountName || a.name) === paymentTrimmed)
        : null;
      const queued = enqueueTransaction(
        user.id,
        {
          id: crypto.randomUUID(),
          user_id: user.id,
          date,
          type,
          item_name: itemName,
          category,
          payment_method: paymentTrimmed || null,
          account_id: cachedAccount?.id || null,
          currency: normalizedCurrency,
          amount,
          exchange_rate: offlineRate,
          twd_amount: Math.round(amount * offlineRate * 100) / 100,
          note: note || null,
        },
        getTodayYmd()
      );
      // localStorage 額滿等原因入列失敗:必須明確告知,不能讓交易無聲消失
      if (!queued) throw new Error(t('transaction.offlineQueueFailed'));
      return { date, isEdit: false, queued: true };
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      // 編輯需要先讀伺服器上的既有資料,離線時直接擋下
      if (editId) throw new Error(t('dashboard.offlineActionUnavailable'));
      return queueOffline();
    }

    // 編輯時沿用原本的匯率，避免用今日匯率改寫歷史台幣金額；只有幣別變更才重新取匯率
    let exchangeRate = null;
    if (editId) {
      const { data: existingTx } = await supabase
        .from('transactions')
        .select('currency, exchange_rate')
        .eq('id', editId)
        .maybeSingle();
      if (
        existingTx &&
        String(existingTx.currency).toUpperCase() === normalizedCurrency &&
        Number(existingTx.exchange_rate) > 0
      ) {
        exchangeRate = Number(existingTx.exchange_rate);
      }
    }

    if (exchangeRate == null) {
      if (normalizedCurrency === 'TWD') {
        exchangeRate = 1.0;
      } else {
        const { data: exchangeRateVal, error: rateErr } = await supabase.rpc('get_exchange_rate', {
          p_currency: normalizedCurrency,
        });
        // 查無匯率時擋下送出，避免外幣被靜默以 1:1 記成錯誤的台幣金額
        if (rateErr || exchangeRateVal == null || Number(exchangeRateVal) <= 0) {
          // 網路中斷造成的查詢失敗:新增改走離線入列(匯率從本地快取解析)
          if (!editId && rateErr && isOfflineError(rateErr)) return queueOffline();
          throw new Error(t('transaction.rateUnavailable', { currency: normalizedCurrency }));
        }
        exchangeRate = Number(exchangeRateVal);
      }
    }

    let account = null;
    if (paymentTrimmed) {
      const { data: acc } = await supabase.from('accounts').select('id').eq('name', paymentTrimmed).maybeSingle();
      account = acc;
    }

    const twdAmount = Math.round(amount * exchangeRate * 100) / 100;

    const transactionData = {
      user_id: user.id,
      date,
      type,
      item_name: itemName,
      category,
      payment_method: paymentTrimmed || null,
      account_id: account?.id || null,
      currency: normalizedCurrency,
      amount,
      exchange_rate: exchangeRate,
      twd_amount: twdAmount,
      note: note || null,
    };

    if (editId) {
      const { error } = await supabase.from('transactions').update(transactionData).eq('id', editId);
      if (error) {
        if (isOfflineError(error)) throw new Error(t('dashboard.offlineActionUnavailable'));
        throw error;
      }
    } else {
      const { error } = await supabase.from('transactions').insert(transactionData);
      if (error) {
        // 送出瞬間斷網:沿用已解析好的匯率轉入離線佇列
        if (isOfflineError(error)) return queueOffline(exchangeRate);
        throw error;
      }

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
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error(t('dashboard.offlineActionUnavailable'));
    }
    const { error } = await supabase.from('transactions').delete().eq('id', id);
    if (error) {
      if (isOfflineError(error)) throw new Error(t('dashboard.offlineActionUnavailable'));
      throw error;
    }
  }, [t]);

  return {
    submitTransaction,
    deleteTransaction,
  };
}
