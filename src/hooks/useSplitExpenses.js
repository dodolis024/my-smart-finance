import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

// Module-level cache keyed by groupId
const expenseCache = {};   // { [groupId]: expenses[] }
const settlementCache = {}; // { [groupId]: settlements[] }

export function useSplitExpenses(groupId) {
  const hasCached = groupId && expenseCache[groupId];

  const [expenses, setExpenses] = useState(() =>
    hasCached ? expenseCache[groupId] : []
  );
  const [settlements, setSettlements] = useState(() =>
    groupId && settlementCache[groupId] ? settlementCache[groupId] : []
  );
  const [loading, setLoading] = useState(() => !hasCached);

  // Keep cache in sync
  useEffect(() => {
    if (groupId) {
      expenseCache[groupId] = expenses;
      settlementCache[groupId] = settlements;
    }
  }, [expenses, settlements, groupId]);

  const fetchExpenses = useCallback(async () => {
    if (!groupId) return;
    if (!expenseCache[groupId]) setLoading(true);
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

      // 還款紀錄獨立查詢，表不存在時不影響費用載入
      const setRes = await supabase
        .from('split_settlements')
        .select('*')
        .eq('group_id', groupId)
        .order('created_at', { ascending: false });
      if (!setRes.error) setSettlements(setRes.data || []);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  const addExpense = useCallback(async ({ title, amount, currency, date, note, paidBy, shares }) => {
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

  const updateExpense = useCallback(async (expenseId, { title, amount, currency, date, note, paidBy, shares }) => {
    const { error: expenseError } = await supabase
      .from('split_expenses')
      .update({
        paid_by: paidBy,
        title,
        amount,
        currency: currency || 'TWD',
        date,
        note: note || null,
      })
      .eq('id', expenseId);
    if (expenseError) throw expenseError;

    // 刪除舊的分攤明細，重新插入
    const { error: delError } = await supabase
      .from('split_expense_shares')
      .delete()
      .eq('expense_id', expenseId);
    if (delError) throw delError;

    const { error: sharesError } = await supabase
      .from('split_expense_shares')
      .insert(shares.map(s => ({ expense_id: expenseId, member_id: s.member_id, share: s.share })));
    if (sharesError) throw sharesError;

    await fetchExpenses();
  }, [fetchExpenses]);

  const deleteExpense = useCallback(async (expenseId) => {
    const { error } = await supabase
      .from('split_expenses')
      .delete()
      .eq('id', expenseId);
    if (error) throw error;
    setExpenses(prev => prev.filter(e => e.id !== expenseId));
  }, []);

  // 新增還款紀錄
  const addSettlement = useCallback(async ({ fromMember, toMember, amount, currency }) => {
    const { error } = await supabase
      .from('split_settlements')
      .insert({
        group_id: groupId,
        from_member: fromMember,
        to_member: toMember,
        amount,
        currency: currency || 'TWD',
      });
    if (error) throw error;
    await fetchExpenses();
  }, [groupId, fetchExpenses]);

  // 刪除還款紀錄
  const deleteSettlement = useCallback(async (settlementId) => {
    const { error } = await supabase
      .from('split_settlements')
      .delete()
      .eq('id', settlementId);
    if (error) throw error;
    setSettlements(prev => prev.filter(s => s.id !== settlementId));
  }, []);

  // 結算算法：Minimize Transactions（貪婪配對）
  // rates: { TWD: 1, USD: 31.5, ... }（1單位=多少TWD）；settlementCurrency: 結算幣別
  const calcSettlement = useCallback((members, expenseList, settlementList, rates, settlementCurrency) => {
    const balance = {};
    members.forEach(m => { balance[m.id] = 0; });

    const toRate = (rates && settlementCurrency) ? (rates[settlementCurrency] ?? 1) : 1;

    // 費用：付款人 +amount，參與者 -share
    expenseList.forEach(expense => {
      const fromRate = (rates && expense.currency) ? (rates[expense.currency] ?? 1) : 1;
      const factor = toRate > 0 ? fromRate / toRate : 1;

      if (expense.paid_by) {
        balance[expense.paid_by] = (balance[expense.paid_by] || 0) + Number(expense.amount) * factor;
      }
      (expense.split_expense_shares || []).forEach(s => {
        balance[s.member_id] = (balance[s.member_id] || 0) - Number(s.share) * factor;
      });
    });

    // 還款紀錄：from_member 付了錢（balance +），to_member 收了錢（balance -）
    (settlementList || []).forEach(s => {
      const fromRate = (rates && s.currency) ? (rates[s.currency] ?? 1) : 1;
      const factor = toRate > 0 ? fromRate / toRate : 1;
      const amt = Number(s.amount) * factor;

      balance[s.from_member] = (balance[s.from_member] || 0) + amt;
      balance[s.to_member] = (balance[s.to_member] || 0) - amt;
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
        fromId: debtors[di].id,
        toId: creditors[ci].id,
        amount: Math.round(pay * 100) / 100,
      });
      creditors[ci].amount -= pay;
      debtors[di].amount -= pay;
      if (creditors[ci].amount < 0.01) ci++;
      if (debtors[di].amount < 0.01) di++;
    }

    const memberMap = Object.fromEntries(members.map(m => [m.id, m.name]));
    return transactions.map(t => ({
      fromId: t.fromId,
      toId: t.toId,
      from: memberMap[t.fromId] || t.fromId,
      to: memberMap[t.toId] || t.toId,
      amount: t.amount,
    }));
  }, []);

  return {
    expenses,
    settlements,
    loading,
    fetchExpenses,
    addExpense,
    updateExpense,
    deleteExpense,
    addSettlement,
    deleteSettlement,
    calcSettlement,
  };
}
