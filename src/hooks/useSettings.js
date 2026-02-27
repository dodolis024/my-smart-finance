import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export function useSettings() {
  const [expenseCategories, setExpenseCategories] = useState([]);
  const [incomeCategories, setIncomeCategories] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadSettingsData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [{ data: expenseData }, { data: incomeData }, { data: accountsData }] = await Promise.all([
        supabase.from('settings').select('value').eq('user_id', user.id).eq('key', 'expense_categories').single(),
        supabase.from('settings').select('value').eq('user_id', user.id).eq('key', 'income_categories').single(),
        supabase.from('accounts').select('*').eq('user_id', user.id).order('created_at', { ascending: true }),
      ]);

      setExpenseCategories(expenseData?.value || ['飲食', '飲料', '交通', '旅遊', '娛樂', '購物', '其他']);
      setIncomeCategories(incomeData?.value || ['薪水', '投資', '其他']);
      setAccounts(accountsData || []);
    } finally {
      setLoading(false);
    }
  }, []);

  const saveCategoriesType = useCallback(async (type, categories) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const key = type === 'expense' ? 'expense_categories' : 'income_categories';
    const { error } = await supabase.from('settings').upsert(
      { user_id: user.id, key, value: categories },
      { onConflict: 'user_id,key' }
    );
    if (error) throw error;
    if (type === 'expense') setExpenseCategories([...categories]);
    else setIncomeCategories([...categories]);
  }, []);

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
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from('transactions').update({ category: newName }).eq('user_id', user.id).eq('category', oldName);
    if (error) throw error;
  }, []);

  const saveAccount = useCallback(async (accountData, accountId = null) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const payload = { ...accountData, user_id: user.id };
    if (accountId) {
      const oldAccount = accounts.find((a) => a.id === accountId);
      const { error } = await supabase.from('accounts').update(payload).eq('id', accountId);
      if (error) throw error;
      if (oldAccount?.name && oldAccount.name !== accountData.name) {
        await updateTransactionPaymentMethods(oldAccount.name, accountData.name);
      }
    } else {
      const { error } = await supabase.from('accounts').insert(payload);
      if (error) throw error;
    }
    await loadSettingsData();
  }, [accounts, loadSettingsData]);

  const deleteAccount = useCallback(async (accountId) => {
    const { error } = await supabase.from('accounts').delete().eq('id', accountId);
    if (error) throw error;
    await loadSettingsData();
  }, [loadSettingsData]);

  const updateTransactionPaymentMethods = useCallback(async (oldName, newName) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from('transactions').update({ payment_method: newName }).eq('user_id', user.id).eq('payment_method', oldName);
    if (error) throw error;
  }, []);

  return {
    expenseCategories,
    incomeCategories,
    accounts,
    loading,
    loadSettingsData,
    addCategory,
    renameCategory,
    deleteCategory,
    saveAccount,
    deleteAccount,
  };
}
