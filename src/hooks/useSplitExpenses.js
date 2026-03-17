import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export function useSplitExpenses(groupId) {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchExpenses = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('split_expenses')
        .select(`
          *,
          split_expense_shares ( id, member_id, share )
        `)
        .eq('group_id', groupId)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      setExpenses(data || []);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  const addExpense = useCallback(async ({ title, amount, currency, date, note, paidBy, shares }) => {
    // shares: [{ member_id, share }]
    const { data: expense, error: expenseError } = await supabase
      .from('split_expenses')
      .insert({
        group_id: groupId,
        paid_by: paidBy,
        title,
        amount,
        currency: currency || 'TWD',
        date,
        note: note || null,
      })
      .select()
      .single();
    if (expenseError) throw expenseError;

    const { error: sharesError } = await supabase
      .from('split_expense_shares')
      .insert(shares.map(s => ({ expense_id: expense.id, member_id: s.member_id, share: s.share })));
    if (sharesError) throw sharesError;

    await fetchExpenses();
    return expense;
  }, [groupId, fetchExpenses]);

  const deleteExpense = useCallback(async (expenseId) => {
    const { error } = await supabase
      .from('split_expenses')
      .delete()
      .eq('id', expenseId);
    if (error) throw error;
    setExpenses(prev => prev.filter(e => e.id !== expenseId));
  }, []);

  // 結算算法：Minimize Transactions（貪婪配對）
  // rates: { TWD: 1, USD: 31.5, ... }（1單位=多少TWD）；settlementCurrency: 結算幣別
  const calcSettlement = useCallback((members, expenseList, rates, settlementCurrency) => {
    // 計算每位成員的淨餘額：paid - owed（全部轉換成結算幣別）
    const balance = {};
    members.forEach(m => { balance[m.id] = 0; });

    const toRate = (rates && settlementCurrency) ? (rates[settlementCurrency] ?? 1) : 1;

    expenseList.forEach(expense => {
      const fromRate = (rates && expense.currency) ? (rates[expense.currency] ?? 1) : 1;
      const factor = toRate > 0 ? fromRate / toRate : 1;

      // 付款人加上全額（換算後）
      if (expense.paid_by) {
        balance[expense.paid_by] = (balance[expense.paid_by] || 0) + Number(expense.amount) * factor;
      }
      // 每位參與者扣掉應付份額（換算後）
      (expense.split_expense_shares || []).forEach(s => {
        balance[s.member_id] = (balance[s.member_id] || 0) - Number(s.share) * factor;
      });
    });

    // 分成債主（balance > 0）和欠款人（balance < 0）
    const creditors = [];
    const debtors = [];
    Object.entries(balance).forEach(([id, bal]) => {
      const rounded = Math.round(bal * 100) / 100;
      if (rounded > 0.01) creditors.push({ id, amount: rounded });
      else if (rounded < -0.01) debtors.push({ id, amount: -rounded });
    });

    creditors.sort((a, b) => b.amount - a.amount);
    debtors.sort((a, b) => b.amount - a.amount);

    const transactions = [];
    let ci = 0, di = 0;
    while (ci < creditors.length && di < debtors.length) {
      const pay = Math.min(creditors[ci].amount, debtors[di].amount);
      transactions.push({
        from: debtors[di].id,
        to: creditors[ci].id,
        amount: Math.round(pay * 100) / 100,
      });
      creditors[ci].amount -= pay;
      debtors[di].amount -= pay;
      if (creditors[ci].amount < 0.01) ci++;
      if (debtors[di].amount < 0.01) di++;
    }

    // 帶入成員名稱
    const memberMap = Object.fromEntries(members.map(m => [m.id, m.name]));
    return transactions.map(t => ({
      from: memberMap[t.from] || t.from,
      to: memberMap[t.to] || t.to,
      amount: t.amount,
    }));
  }, []);

  return {
    expenses,
    loading,
    fetchExpenses,
    addExpense,
    deleteExpense,
    calcSettlement,
  };
}
