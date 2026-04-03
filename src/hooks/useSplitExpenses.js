import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { notifySplit } from '@/lib/splitNotify';
import { calcSettlement } from '@/lib/splitSettlement';
import { getCachedExpenses, getCachedSettlements, updateCache } from '@/lib/splitCache';
import { getTodayYmd } from '@/lib/utils';

export function useSplitExpenses(groupId, { actorName = '', actorUserId = '', groupName = '' } = {}) {
  const hasCached = groupId && getCachedExpenses(groupId);

  const [expenses, setExpenses] = useState(() =>
    hasCached ? getCachedExpenses(groupId) : []
  );
  const [settlements, setSettlements] = useState(() =>
    groupId && getCachedSettlements(groupId) ? getCachedSettlements(groupId) : []
  );
  const [loading, setLoading] = useState(() => !hasCached);

  // Keep cache in sync
  useEffect(() => {
    if (groupId) {
      updateCache(groupId, expenses, settlements);
    }
  }, [expenses, settlements, groupId]);

  const fetchExpenses = useCallback(async () => {
    if (!groupId) return;
    if (!getCachedExpenses(groupId)) setLoading(true);
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

    // 若新增的費用日期是今天，且用戶是已連結成員，則同步簽到記錄
    if (actorUserId && date === getTodayYmd()) {
      await supabase.from('checkins').upsert(
        { user_id: actorUserId, date, source: 'onTimeTransaction' },
        { onConflict: 'user_id,date' }
      );
    }

    notifySplit({
      event: 'expense_added',
      group_id: groupId,
      group_name: groupName,
      actor_name: actorName,
      actor_user_id: actorUserId,
      expense_title: title,
      expense_amount: amount,
      currency: currency || 'TWD',
    });
    return expense;
  }, [groupId, groupName, actorName, actorUserId, fetchExpenses]);

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
    notifySplit({
      event: 'expense_updated',
      group_id: groupId,
      group_name: groupName,
      actor_name: actorName,
      actor_user_id: actorUserId,
      expense_title: title,
    });
  }, [groupId, groupName, actorName, actorUserId, fetchExpenses]);

  const deleteExpense = useCallback(async (expenseId) => {
    const expenseToDelete = expenses.find(e => e.id === expenseId);
    const { error } = await supabase
      .from('split_expenses')
      .delete()
      .eq('id', expenseId);
    if (error) throw error;
    setExpenses(prev => prev.filter(e => e.id !== expenseId));
    notifySplit({
      event: 'expense_deleted',
      group_id: groupId,
      group_name: groupName,
      actor_name: actorName,
      actor_user_id: actorUserId,
      expense_title: expenseToDelete?.title ?? '',
    });
  }, [expenses, groupId, groupName, actorName, actorUserId]);

  // 新增還款紀錄
  const addSettlement = useCallback(async ({ fromMember, toMember, amount, currency, fromName = '', toName = '' }) => {
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
    notifySplit({
      event: 'settlement_added',
      group_id: groupId,
      group_name: groupName,
      actor_name: actorName,
      actor_user_id: actorUserId,
      expense_amount: amount,
      currency: currency || 'TWD',
      from_name: fromName,
      to_name: toName,
    });
  }, [groupId, groupName, actorName, actorUserId, fetchExpenses]);

  // 刪除還款紀錄
  const deleteSettlement = useCallback(async (settlementId) => {
    const { error } = await supabase
      .from('split_settlements')
      .delete()
      .eq('id', settlementId);
    if (error) throw error;
    setSettlements(prev => prev.filter(s => s.id !== settlementId));
  }, []);

  // Wrap pure calcSettlement in useCallback for stable reference
  const calcSettlementCb = useCallback(
    (members, expenseList, settlementList, rates, settlementCurrency) =>
      calcSettlement(members, expenseList, settlementList, rates, settlementCurrency),
    []
  );

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
    calcSettlement: calcSettlementCb,
  };
}
