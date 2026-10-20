import { useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { useCachedResource } from '@/hooks/useCachedResource';
import { notifyDataChanged } from '@/lib/dataEvents';
import { ACCOUNT_ORDER_KEY, sortAccountsByOrder } from '@/lib/accountOrder';
import { isAccountActive } from '@/lib/accountStatus';

const DEFAULT_EXPENSE_CATEGORIES = {
  zh: ['飲食', '飲料', '交通', '旅遊', '娛樂', '購物', '其他'],
  en: ['Food', 'Drinks', 'Transport', 'Travel', 'Entertainment', 'Shopping', 'Other'],
};
const DEFAULT_INCOME_CATEGORIES = {
  zh: ['薪水', '投資', '其他'],
  en: ['Salary', 'Investment', 'Other'],
};

const CACHE_KEY = 'settings';
const INITIAL = { expenseCategories: [], incomeCategories: [], accounts: [], accountOrder: [] };

export function useSettings() {
  const { user } = useAuth();
  const { lang, t } = useLanguage();

  const { data, setData, loading, error, load } = useCachedResource(CACHE_KEY, {
    userId: user?.id,
    initial: INITIAL,
    fetcher: async () => {
      const [{ data: expenseData }, { data: incomeData }, { data: accountsData }, { data: orderData }] = await Promise.all([
        supabase.from('settings').select('value').eq('user_id', user.id).eq('key', 'expense_categories').single(),
        supabase.from('settings').select('value').eq('user_id', user.id).eq('key', 'income_categories').single(),
        supabase.from('accounts').select('*').eq('user_id', user.id).order('created_at', { ascending: true }),
        supabase.from('settings').select('value').eq('user_id', user.id).eq('key', ACCOUNT_ORDER_KEY).maybeSingle(),
      ]);
      const accountOrder = Array.isArray(orderData?.value) ? orderData.value : [];
      return {
        expenseCategories: expenseData?.value || DEFAULT_EXPENSE_CATEGORIES[lang] || DEFAULT_EXPENSE_CATEGORIES.zh,
        incomeCategories: incomeData?.value || DEFAULT_INCOME_CATEGORIES[lang] || DEFAULT_INCOME_CATEGORIES.zh,
        accounts: sortAccountsByOrder(accountsData || [], accountOrder),
        accountOrder,
      };
    },
  });
  const { expenseCategories, incomeCategories, accounts, accountOrder } = data;

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
      // 交易與帳戶有兩條連結：payment_method 存名稱、account_id 存外鍵（分帳同步進來的交易
      // 只有後者）。只查名稱會漏掉分帳同步的交易，刪掉帳戶後它們的 account_id 被清成 NULL，
      // 帳戶餘額就少算這些筆。PostgREST 的 or 濾鏡裡名稱含逗號或括號要用雙引號包住
      const quoted = `"${String(account.name).replace(/[\\"]/g, (c) => `\\${c}`)}"`;
      const { count, error: countError } = await supabase
        .from('transactions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .or(`payment_method.eq.${quoted},account_id.eq.${account.id}`);
      if (!countError && count > 0) {
        // 已停用的帳戶不必再勸他去停用
        const key = isAccountActive(account) ? 'settings.account.hasTransactions' : 'settings.account.hasTransactionsInactive';
        throw new Error(t(key, { name: account.name, count }));
      }
    }
    const { error: deleteError } = await supabase.from('accounts').delete().eq('id', accountId);
    if (deleteError) throw deleteError;
    await loadSettingsData();
    notifyDataChanged();
  }, [user, accounts, loadSettingsData, t]);

  /**
   * 停用／啟用帳戶（剪卡、關戶）。不動任何交易：歷史與統計全部保留，只是不再出現在
   * 記帳表單、訂閱、餘額面板。儀表板的帳戶來自 get_dashboard_data，所以要通知它重抓。
   */
  const setAccountActive = useCallback(async (accountId, active) => {
    if (!user) return;
    const { error: updateError } = await supabase
      .from('accounts')
      .update({ is_active: Boolean(active) })
      .eq('id', accountId)
      .eq('user_id', user.id);
    if (updateError) throw updateError;
    await loadSettingsData();
    notifyDataChanged();
  }, [user, loadSettingsData]);

  /** 停用前提醒用：還在扣款、且付款方式是這個帳戶的訂閱有幾個（排程仍會記到它名下） */
  const countSubscriptionsUsing = useCallback(async (accountName) => {
    if (!user || !accountName) return 0;
    const { count, error: countError } = await supabase
      .from('subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_active', true)
      .eq('payment_method', accountName);
    return countError ? 0 : (count || 0);
  }, [user]);

  /**
   * 拖曳排序支付工具：以整份 id 順序覆寫 settings 的 account_order。
   * 樂觀更新（同 reorderCategoriesTo）：本地先到位，存檔在背景進行，失敗才回滾。
   */
  const reorderAccountsTo = useCallback(async (orderedIds) => {
    if (!user) return;
    const sameSet = orderedIds.length === accounts.length
      && orderedIds.every((id) => accounts.some((a) => a.id === id));
    if (!sameSet) return;
    const prevAccounts = accounts;
    const prevOrder = accountOrder;
    const reordered = sortAccountsByOrder(accounts, orderedIds);
    setData((prev) => ({ ...prev, accounts: reordered, accountOrder: orderedIds }));
    try {
      const { error: saveError } = await supabase.from('settings').upsert(
        { user_id: user.id, key: ACCOUNT_ORDER_KEY, value: orderedIds },
        { onConflict: 'user_id,key' }
      );
      if (saveError) throw saveError;
      // 儀表板的帳戶來自 get_dashboard_data、不吃這份快取，要通知它重抓才會照新順序排
      notifyDataChanged();
    } catch (err) {
      setData((prev) => ({ ...prev, accounts: prevAccounts, accountOrder: prevOrder }));
      throw err;
    }
  }, [user, accounts, accountOrder, setData]);

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
    setAccountActive,
    countSubscriptionsUsing,
    reorderAccountsTo,
  };
}
