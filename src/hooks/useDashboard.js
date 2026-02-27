import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { getTodayYmd } from '@/lib/utils';

export function useDashboard() {
  const [dashboardData, setDashboardData] = useState(null);
  const [transactionHistoryFull, setTransactionHistoryFull] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [categoriesExpense, setCategoriesExpense] = useState([]);
  const [categoriesIncome, setCategoriesIncome] = useState([]);
  const [currencies, setCurrencies] = useState(['TWD']);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState({ totalIncome: 0, totalExpense: 0, balance: 0 });

  const fetchDashboardData = useCallback(async (year, month) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_dashboard_data', {
        p_client_today: getTodayYmd(),
        p_month: parseInt(month, 10),
        p_year: parseInt(year, 10),
      });

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
      console.error('fetchDashboardData error:', error);
      throw error;
    } finally {
      setLoading(false);
    }
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
