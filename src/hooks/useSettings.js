import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

// Module-level cache
let cachedExpenseCats = null;
let cachedIncomeCats = null;
let cachedAccounts = null;
let cachedUserId = null;

export function useSettings() {
  const { user } = useAuth();
  const hasCached = cachedUserId === user?.id && cachedExpenseCats;

  const [expenseCategories, setExpenseCategories] = useState(() =>
    hasCached ? cachedExpenseCats : []
  );
  const [incomeCategories, setIncomeCategories] = useState(() =>
    hasCached ? cachedIncomeCats : []
  );
  const [accounts, setAccounts] = useState(() =>
    hasCached ? cachedAccounts : []
  );
  const [loading, setLoading] = useState(() => !hasCached);
  const [loadError, setLoadError] = useState(null);

  // Keep cache in sync
  useEffect(() => {
    cachedExpenseCats = expenseCategories;
    cachedIncomeCats = incomeCategories;
    cachedAccounts = accounts;
    cachedUserId = user?.id ?? null;
  }, [expenseCategories, incomeCategories, accounts, user?.id]);

  const loadSettingsData = useCallback(async () => {
    if (!user) return;
    if (!cachedExpenseCats || cachedUserId !== user.id) setLoading(true);
    setLoadError(null);
    try {
      const [{ data: expenseData }, { data: incomeData }, { data: accountsData }] = await Promise.all([
        supabase.from('settings').select('value').eq('user_id', user.id).eq('key', 'expense_categories').single(),
        supabase.from('settings').select('value').eq('user_id', user.id).eq('key', 'income_categories').single(),
        supabase.from('accounts').select('*').eq('user_id', user.id).order('created_at', { ascending: true }),
      ]);

      setExpenseCategories(expenseData?.value || ['飲食', '飲料', '交通', '旅遊', '娛樂', '購物', '其他']);
      setIncomeCategories(incomeData?.value || ['薪水', '投資', '其他']);
      setAccounts(accountsData || []);
    } catch (err) {
      setLoadError(err?.message || '載入設定失敗，請稍後再試');
    } finally {
      setLoading(false);
    }
  }, [user]);

  const saveCategoriesType = useCallback(async (type, categories) => {
    if (!user) return;
    const key = type === 'expense' ? 'expense_categories' : 'income_categories';
    const { error } = await supabase.from('settings').upsert(
      { user_id: user.id, key, value: categories },
      { onConflict: 'user_id,key' }
    );
    if (error) throw error;
    if (type === 'expense') setExpenseCategories([...categories]);
    else setIncomeCategories([...categories]);
  }, [user]);

  const addCategory = useCallback(async (type, name) => {
    const categories = type === 'expense' ? [...expenseCategories] : [...incomeCategories];
    if (categories.includes(name.trim())) throw new Error('此類別已存在！');
    categories.push(name.trim());
    await saveCategoriesType(type, categories);
  }, [expenseCategories, incomeCategories, saveCategoriesType]);

  const renameCategory = useCallback(async (type, oldName, newName) => {
    const categories = type === 'expense' ? [...expenseCategories] : [...incomeCategories];
    const trimmed = newName.trim();
    if (categories.includes(trimmed)) throw new Error('此類別名稱已存在！');
    const idx = categories.indexOf(oldName);
    if (idx === -1) return;
    categories[idx] = trimmed;
    await saveCategoriesType(type, categories);
    await updateTransactionCategories(oldName, trimmed);
  }, [expenseCategories, incomeCategories, saveCategoriesType]);

  const deleteCategory = useCallback(async (type, name) => {
    const categories = (type === 'expense' ? [...expenseCategories] : [...incomeCategories]).filter((c) => c !== name);
    await saveCategoriesType(type, categories);
  }, [expenseCategories, incomeCategories, saveCategoriesType]);

  const updateTransactionCategories = useCallback(async (oldName, newName) => {
    if (!user) return;
    const { error } = await supabase.from('transactions').update({ category: newName }).eq('user_id', user.id).eq('category', oldName);
    if (error) throw error;
  }, [user]);

  const saveAccount = useCallback(async (accountData, accountId = null) => {
    if (!user) return;
    const trimmedName = accountData.name?.trim();
    // 防重複：同名帳戶已存在（排除自己）
    const isDuplicate = accounts.some(
      (a) => a.name === trimmedName && a.id !== accountId
    );
    if (isDuplicate) throw new Error(`帳戶名稱「${trimmedName}」已存在，請使用不同名稱。`);

    const payload = { ...accountData, name: trimmedName, user_id: user.id };
    if (accountId) {
      const oldAccount = accounts.find((a) => a.id === accountId);
      const { error } = await supabase.from('accounts').update(payload).eq('id', accountId);
      if (error) throw error;
      if (oldAccount?.name && oldAccount.name !== trimmedName) {
        await updateTransactionPaymentMethods(oldAccount.name, trimmedName);
      }
    } else {
      const { error } = await supabase.from('accounts').insert(payload);
      if (error) throw error;
    }
    await loadSettingsData();
  }, [user, accounts, loadSettingsData]);

  const deleteAccount = useCallback(async (accountId) => {
    const account = accounts.find(a => a.id === accountId);
    if (account && user) {
      const { count, error: countError } = await supabase
        .from('transactions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('payment_method', account.name);
      if (!countError && count > 0) {
        throw new Error(`「${account.name}」仍有 ${count} 筆交易記錄，請先將這些交易改為其他帳戶後再刪除。`);
      }
    }
    const { error } = await supabase.from('accounts').delete().eq('id', accountId);
    if (error) throw error;
    await loadSettingsData();
  }, [user, accounts, loadSettingsData]);

  const updateTransactionPaymentMethods = useCallback(async (oldName, newName) => {
    if (!user) return;
    const { error } = await supabase.from('transactions').update({ payment_method: newName }).eq('user_id', user.id).eq('payment_method', oldName);
    if (error) throw error;
  }, [user]);

  return {
    expenseCategories,
    incomeCategories,
    accounts,
    loading,
    loadError,
    loadSettingsData,
    addCategory,
    renameCategory,
    deleteCategory,
    saveAccount,
    deleteAccount,
  };
}
