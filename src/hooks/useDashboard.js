import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { getTodayYmd } from '@/lib/utils';

export function useDashboard() {
  const [dashboardData, setDashboardData] = useState(null);
  const [transactionHistoryFull, setTransactionHistoryFull] = useState([]);
  const [creditHistory, setCreditHistory] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [categoriesExpense, setCategoriesExpense] = useState([]);
  const [categoriesIncome, setCategoriesIncome] = useState([]);
  const [currencies, setCurrencies] = useState(['TWD']);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState({ totalIncome: 0, totalExpense: 0, balance: 0 });
  const requestIdRef = useRef(0);

  const fetchDashboardData = useCallback(async (year, month) => {
    const reqId = ++requestIdRef.current;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_dashboard_data', {
        p_client_today: getTodayYmd(),
        p_month: parseInt(month, 10),
        p_year: parseInt(year, 10),
      });

      if (reqId !== requestIdRef.current) return null;

      if (error) throw new Error(error.message || '無法取得資料');
      if (!data || !data.success) throw new Error(data?.error || '無法取得資料');

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
    try {
      const { data: codes, error } = await supabase.rpc('get_available_currencies');
      const list = Array.isArray(codes) ? codes : codes ? [codes] : [];
      if (error || list.length === 0) return;
      const upper = list.map((c) => String(c).toUpperCase());
      if (!upper.includes('TWD')) upper.unshift('TWD');
      setCurrencies(upper);
    } catch {
      // Keep default ['TWD']
    }
  }, []);

  return {
    dashboardData,
    transactionHistoryFull,
    creditHistory,
    fetchCreditHistory,
    accounts,
    categoriesExpense,
    categoriesIncome,
    currencies,
    loading,
    summary,
    fetchDashboardData,
    fetchCurrencies,
  };
}
