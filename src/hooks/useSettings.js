import { useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { useCachedResource } from '@/hooks/useCachedResource';

const DEFAULT_EXPENSE_CATEGORIES = {
  zh: ['飲食', '飲料', '交通', '旅遊', '娛樂', '購物', '其他'],
  en: ['Food', 'Drinks', 'Transport', 'Travel', 'Entertainment', 'Shopping', 'Other'],
};
const DEFAULT_INCOME_CATEGORIES = {
  zh: ['薪水', '投資', '其他'],
  en: ['Salary', 'Investment', 'Other'],
};

const CACHE_KEY = 'settings';
const INITIAL = { expenseCategories: [], incomeCategories: [], accounts: [] };

export function useSettings() {
  const { user } = useAuth();
  const { lang, t } = useLanguage();

  const { data, setData, loading, error, load } = useCachedResource(CACHE_KEY, {
    userId: user?.id,
    initial: INITIAL,
    fetcher: async () => {
      const [{ data: expenseData }, { data: incomeData }, { data: accountsData }] = await Promise.all([
        supabase.from('settings').select('value').eq('user_id', user.id).eq('key', 'expense_categories').single(),
        supabase.from('settings').select('value').eq('user_id', user.id).eq('key', 'income_categories').single(),
        supabase.from('accounts').select('*').eq('user_id', user.id).order('created_at', { ascending: true }),
      ]);
      return {
        expenseCategories: expenseData?.value || DEFAULT_EXPENSE_CATEGORIES[lang] || DEFAULT_EXPENSE_CATEGORIES.zh,
        incomeCategories: incomeData?.value || DEFAULT_INCOME_CATEGORIES[lang] || DEFAULT_INCOME_CATEGORIES.zh,
        accounts: accountsData || [],
      };
    },
  });
  const { expenseCategories, incomeCategories, accounts } = data;

  const loadSettingsData = useCallback(async () => {
    if (!user) return;
    try {
      await load();
    } catch {
      // 沿用原本行為：載入失敗只寫入 loadError，不對呼叫端拋錯
    }
  }, [user, load]);

  const saveCategoriesType = useCallback(async (type, categories) => {
    if (!user) return;
    const key = type === 'expense' ? 'expense_categories' : 'income_categories';
    const { error: saveError } = await supabase.from('settings').upsert(
      { user_id: user.id, key, value: categories },
      { onConflict: 'user_id,key' }
    );
    if (saveError) throw saveError;
    const field = type === 'expense' ? 'expenseCategories' : 'incomeCategories';
    setData((prev) => ({ ...prev, [field]: [...categories] }));
  }, [user, setData]);

  const updateTransactionCategories = useCallback(async (oldName, newName) => {
    if (!user) return;
    const { error: updateError } = await supabase.from('transactions').update({ category: newName }).eq('user_id', user.id).eq('category', oldName);
    if (updateError) throw updateError;
  }, [user]);

  const updateTransactionPaymentMethods = useCallback(async (oldName, newName) => {
    if (!user) return;
    const { error: updateError } = await supabase.from('transactions').update({ payment_method: newName }).eq('user_id', user.id).eq('payment_method', oldName);
    if (updateError) throw updateError;
  }, [user]);

  const addCategory = useCallback(async (type, name) => {
    const categories = type === 'expense' ? [...expenseCategories] : [...incomeCategories];
    if (categories.includes(name.trim())) throw new Error(t('settings.category.alreadyExists'));
    categories.push(name.trim());
    await saveCategoriesType(type, categories);
  }, [expenseCategories, incomeCategories, saveCategoriesType, t]);

  const renameCategory = useCallback(async (type, oldName, newName) => {
    const categories = type === 'expense' ? [...expenseCategories] : [...incomeCategories];
    const trimmed = newName.trim();
    if (categories.includes(trimmed)) throw new Error(t('settings.category.nameAlreadyExists'));
    const idx = categories.indexOf(oldName);
    if (idx === -1) return;
    categories[idx] = trimmed;
    await saveCategoriesType(type, categories);
    await updateTransactionCategories(oldName, trimmed);
  }, [expenseCategories, incomeCategories, saveCategoriesType, t, updateTransactionCategories]);

  const deleteCategory = useCallback(async (type, name) => {
    const categories = (type === 'expense' ? [...expenseCategories] : [...incomeCategories]).filter((c) => c !== name);
    await saveCategoriesType(type, categories);
  }, [expenseCategories, incomeCategories, saveCategoriesType]);

  const saveAccount = useCallback(async (accountData, accountId = null) => {
    if (!user) return;
    const trimmedName = accountData.name?.trim();
    // 防重複：同名帳戶已存在（排除自己）
    const isDuplicate = accounts.some(
      (a) => a.name === trimmedName && a.id !== accountId
    );
    if (isDuplicate) throw new Error(t('settings.account.nameAlreadyExists', { name: trimmedName }));

    const payload = { ...accountData, name: trimmedName, user_id: user.id };
    if (accountId) {
      const oldAccount = accounts.find((a) => a.id === accountId);
      const { error: saveError } = await supabase.from('accounts').update(payload).eq('id', accountId);
      if (saveError) throw saveError;
      if (oldAccount?.name && oldAccount.name !== trimmedName) {
        await updateTransactionPaymentMethods(oldAccount.name, trimmedName);
      }
    } else {
      const { error: saveError } = await supabase.from('accounts').insert(payload);
      if (saveError) throw saveError;
    }
    await loadSettingsData();
  }, [user, accounts, loadSettingsData, t, updateTransactionPaymentMethods]);

  const deleteAccount = useCallback(async (accountId) => {
    const account = accounts.find(a => a.id === accountId);
    if (account && user) {
      const { count, error: countError } = await supabase
        .from('transactions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('payment_method', account.name);
      if (!countError && count > 0) {
        throw new Error(t('settings.account.hasTransactions', { name: account.name, count }));
      }
    }
    const { error: deleteError } = await supabase.from('accounts').delete().eq('id', accountId);
    if (deleteError) throw deleteError;
    await loadSettingsData();
  }, [user, accounts, loadSettingsData, t]);

  return {
    expenseCategories,
    incomeCategories,
    accounts,
    loading,
    loadError: error ? (error.message || t('settings.loadError')) : null,
    loadSettingsData,
    addCategory,
    renameCategory,
    deleteCategory,
    saveAccount,
    deleteAccount,
  };
}
