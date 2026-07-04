import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export function useYearlyReview(year) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  const fetch = useCallback(async (y) => {
    setLoading(true);
    setError(null);
    try {
      const { data: result, error: rpcError } = await supabase.rpc('get_yearly_review', { p_year: y });
      if (rpcError) throw rpcError;
      if (!result?.success) throw new Error(result?.error || 'Unknown error');
      setData(result);
    } catch (err) {
      setError(err.message || 'Failed to load yearly review');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (year) fetch(year);
  }, [year, fetch]);

  return {
    loading,
    error,
    annualTotals: data?.annualTotals ?? null,
    previousTotals: data?.previousTotals ?? null,
    monthlyBreakdown: data?.monthlyBreakdown ?? [],
    topCategories: data?.topCategories ?? [],
    topExpenses: data?.topExpenses ?? [],
    highlights: data?.highlights ?? null,
  };
}
