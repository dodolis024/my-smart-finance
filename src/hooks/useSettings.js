import { useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { useCachedResource } from '@/hooks/useCachedResource';
import { notifyDataChanged } from '@/lib/dataEvents';

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

  // 只寫 settings.value，不動交易。儀表板的類別下拉已透過 'settings' 快取訂閱即時同步
  // （useDashboard），故新增／刪除／排序類別不需要 notifyDataChanged；只有會連帶改寫舊交易的
  // 改名，以及帳戶異動（儀表板的帳戶來自 get_dashboard_data，非此快取）才需要。
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
    // 舊交易的類別已被改寫，通知在此面板下方的儀表板重抓，否則明細與圖表還停在舊名稱。
    // 必須等 updateTransactionCategories 完成才通知，早一步重抓會拿到改寫前的交易。
    notifyDataChanged();
  }, [expenseCategories, incomeCategories, saveCategoriesType, t, updateTransactionCategories]);

  const deleteCategory = useCallback(async (type, name) => {
    const categories = (type === 'expense' ? [...expenseCategories] : [...incomeCategories]).filter((c) => c !== name);
    await saveCategoriesType(type, categories);
  }, [expenseCategories, incomeCategories, saveCategoriesType]);

  // 拖曳排序：以整個新順序覆寫（來源清單須與現有類別相同，只是順序不同）。
  // 樂觀更新：先讓本地畫面立即到位（拖曳放手不閃動），存檔在背景進行，失敗才回滾。
  const reorderCategoriesTo = useCallback(async (type, orderedNames) => {
    const current = type === 'expense' ? expenseCategories : incomeCategories;
    const sameSet = orderedNames.length === current.length && orderedNames.every((n) => current.includes(n));
    if (!sameSet) return;
    const field = type === 'expense' ? 'expenseCategories' : 'incomeCategories';
    const prevOrder = [...current];
    setData((prev) => ({ ...prev, [field]: [...orderedNames] }));
    try {
      await saveCategoriesType(type, orderedNames);
    } catch (err) {
      setData((prev) => ({ ...prev, [field]: prevOrder }));
      throw err;
    }
  }, [expenseCategories, incomeCategories, saveCategoriesType, setData]);

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
    // 儀表板的帳戶（信用額度、付款方式下拉、信用卡卡片）另外由 get_dashboard_data 提供，
    // 不吃這裡的快取，不通知的話要手動刷新才看得到新額度
    notifyDataChanged();
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
    notifyDataChanged();
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
    reorderCategoriesTo,
    saveAccount,
    deleteAccount,
  };
}
