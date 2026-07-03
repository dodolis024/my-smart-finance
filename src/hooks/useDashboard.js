import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { getTodayYmd } from '@/lib/utils';

// Module-level cache for currencies (rarely changes)
let cachedCurrencies = null;
// 預設幣別為「每位使用者」的設定，需以 userId 綁定快取，避免切換帳號時沿用他人的值
let cachedDefaultCurrency = null;
let cachedDefaultCurrencyUserId = null;

// 預設幣別的跨實例訂閱：任一 useDashboard 更新後，通知所有實例同步重繪
const defaultCurrencyListeners = new Set();
function notifyDefaultCurrency() {
  defaultCurrencyListeners.forEach((l) => l());
}

export function useDashboard() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [dashboardData, setDashboardData] = useState(null);
  const [transactionHistoryFull, setTransactionHistoryFull] = useState([]);
  const [creditHistory, setCreditHistory] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [categoriesExpense, setCategoriesExpense] = useState([]);
  const [categoriesIncome, setCategoriesIncome] = useState([]);
  const [currencies, setCurrencies] = useState(() => cachedCurrencies || ['TWD']);
  const [defaultCurrency, setDefaultCurrency] = useState(() =>
    (cachedDefaultCurrency && cachedDefaultCurrencyUserId === user?.id) ? cachedDefaultCurrency : 'TWD'
  );
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState({ totalIncome: 0, totalExpense: 0, balance: 0 });
  const requestIdRef = useRef(0);

  // 訂閱預設幣別變更，讓其他實例（例如已開啟的記帳表單）即時同步
  useEffect(() => {
    const sync = () => {
      setDefaultCurrency(
        (cachedDefaultCurrency && cachedDefaultCurrencyUserId === user?.id) ? cachedDefaultCurrency : 'TWD'
      );
    };
    defaultCurrencyListeners.add(sync);
    return () => defaultCurrencyListeners.delete(sync);
  }, [user?.id]);

  const removeTransactionLocally = useCallback((id) => {
    setTransactionHistoryFull((prev) => {
      const removed = prev.find((tx) => tx.id === id);
      if (!removed) return prev;
      const next = prev.filter((tx) => tx.id !== id);
      const amt = typeof removed.twdAmount === 'number' ? removed.twdAmount : 0;
      setSummary((s) => {
        if (removed.type === 'income') {
          return { ...s, totalIncome: s.totalIncome - amt, balance: s.balance - amt };
        }
        return { ...s, totalExpense: s.totalExpense - amt, balance: s.balance + amt };
      });
      return next;
    });
  }, []);

  const fetchDashboardData = useCallback(async (year, month, { silent = false } = {}) => {
    const reqId = ++requestIdRef.current;
    if (!silent) setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_dashboard_data', {
        p_client_today: getTodayYmd(),
        p_month: parseInt(month, 10),
        p_year: parseInt(year, 10),
      });

      if (reqId !== requestIdRef.current) return null;

      if (error) throw new Error(error.message || t('dashboard.loadFailed'));
      if (!data || !data.success) throw new Error(data?.error || t('dashboard.loadFailed'));

      setDashboardData(data);
      setSummary(data.summary || { totalIncome: 0, totalExpense: 0, balance: 0 });
      setTransactionHistoryFull(data.history || []);
      setAccounts(data.accounts || []);
      setCategoriesExpense(data.categoriesExpense || []);
      setCategoriesIncome(data.categoriesIncome || []);

      return data;
    } catch (error) {
      if (reqId !== requestIdRef.current) return null;
      throw error;
    } finally {
      if (reqId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const fetchCreditHistory = useCallback(async (account) => {
    const billingDay = account.billing_day || account.billingDay;
    if (!billingDay) return;

    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    const currentDay = today.getDate();

    let lastBillingYear = currentYear;
    let lastBillingMonth = currentMonth;
    if (currentDay < billingDay) {
      lastBillingMonth -= 1;
      if (lastBillingMonth < 1) { lastBillingMonth = 12; lastBillingYear -= 1; }
    }
    let prevBillingYear = lastBillingYear;
    let prevBillingMonth = lastBillingMonth - 1;
    if (prevBillingMonth < 1) { prevBillingMonth = 12; prevBillingYear -= 1; }

    const pad = (n) => String(n).padStart(2, '0');
    const fromDate = `${prevBillingYear}-${pad(prevBillingMonth)}-${pad(billingDay)}`;
    const toDate = `${currentYear}-${pad(currentMonth)}-${pad(currentDay)}`;

    const { data, error } = await supabase
      .from('transactions')
      .select('id, type, date, account_id, payment_method, twd_amount')
      .gte('date', fromDate)
      .lte('date', toDate);

    if (error) return;

    setCreditHistory(
      (data || []).map((tx) => ({
        ...tx,
        paymentMethod: tx.payment_method,
        twdAmount: tx.twd_amount,
      }))
    );
  }, []);

  const fetchCurrencies = useCallback(async () => {
    // 載入幣別清單
    if (!cachedCurrencies) {
      try {
        const { data: codes, error } = await supabase.rpc('get_available_currencies');
        const list = Array.isArray(codes) ? codes : codes ? [codes] : [];
        if (!error && list.length > 0) {
          const PREFERRED_ORDER = ['TWD', 'USD', 'JPY', 'KRW', 'EUR', 'GBP'];
          const upper = list.map((c) => String(c).toUpperCase());
          upper.sort((a, b) => {
            const ai = PREFERRED_ORDER.indexOf(a);
            const bi = PREFERRED_ORDER.indexOf(b);
            if (ai !== -1 && bi !== -1) return ai - bi;
            if (ai !== -1) return -1;
            if (bi !== -1) return 1;
            return a.localeCompare(b);
          });
          if (!upper.includes('TWD')) upper.unshift('TWD');
          cachedCurrencies = upper;
          setCurrencies(upper);
        }
      } catch {
        // Keep default ['TWD']
      }
    }

    // 載入使用者的預設幣別（帳號切換時重新載入）
    if (user && (cachedDefaultCurrency === null || cachedDefaultCurrencyUserId !== user.id)) {
      try {
        const { data } = await supabase
          .from('settings')
          .select('value')
          .eq('user_id', user.id)
          .eq('key', 'default_currency')
          .single();
        const code = data?.value ? String(data.value).toUpperCase() : 'TWD';
        cachedDefaultCurrency = code;
        cachedDefaultCurrencyUserId = user.id;
        setDefaultCurrency(code);
        notifyDefaultCurrency();
      } catch {
        // Keep default 'TWD'
      }
    }
  }, [user]);

  const saveDefaultCurrency = useCallback(async (code) => {
    if (!user) return;
    const normalized = String(code).toUpperCase();
    const { error } = await supabase.from('settings').upsert(
      { user_id: user.id, key: 'default_currency', value: normalized },
      { onConflict: 'user_id,key' }
    );
    if (error) throw error;
    cachedDefaultCurrency = normalized;
    cachedDefaultCurrencyUserId = user.id;
    setDefaultCurrency(normalized);
    notifyDefaultCurrency();
  }, [user]);

  return {
    dashboardData,
    transactionHistoryFull,
    creditHistory,
    fetchCreditHistory,
    accounts,
    categoriesExpense,
    categoriesIncome,
    currencies,
    defaultCurrency,
    loading,
    summary,
    fetchDashboardData,
    fetchCurrencies,
    saveDefaultCurrency,
    removeTransactionLocally,
  };
}
