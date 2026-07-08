import { useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { notifySplit } from '@/lib/splitNotify';
import { calcSettlement } from '@/lib/splitSettlement';
import { getTodayYmd } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { useCachedResource } from '@/hooks/useCachedResource';

const INITIAL = { expenses: [], settlements: [] };

export function useSplitExpenses(groupId, { actorName = '', actorUserId = '', groupName = '' } = {}) {
  const { user } = useAuth();

  // 快取鍵含 groupId（各群組獨立）、綁 userId（換帳號自動失效），
  // 並納入 resourceCache 的 clearAllCaches 範圍（登出一次清空）。
  const { data, setData, loading, load } = useCachedResource(`split-expenses:${groupId ?? ''}`, {
    userId: user?.id,
    initial: INITIAL,
    fetcher: async () => {
      const { data: expenseRows, error } = await supabase
        .from('split_expenses')
        .select(`
          *,
          split_expense_shares ( id, member_id, share )
        `)
        .eq('group_id', groupId)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;

      // 還款紀錄獨立查詢，表不存在時不影響費用載入（沿用現值）
      const setRes = await supabase
        .from('split_settlements')
        .select('*')
        .eq('group_id', groupId)
        .order('created_at', { ascending: false });
      return {
        expenses: expenseRows || [],
        settlements: setRes.error ? data.settlements : (setRes.data || []),
      };
    },
  });
  const { expenses, settlements } = data;

  const fetchExpenses = useCallback(async () => {
    if (!groupId) return;
    await load();
  }, [groupId, load]);

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
    // 以 RPC 原子更新費用與分攤明細，避免刪除舊分攤後插入失敗留下不完整資料
    const { error } = await supabase.rpc('update_split_expense', {
      p_expense_id: expenseId,
      p_title: title,
      p_amount: amount,
      p_currency: currency || 'TWD',
      p_date: date,
      p_note: note || null,
      p_paid_by: paidBy,
      p_shares: shares.map(s => ({ member_id: s.member_id, share: s.share })),
    });
    if (error) throw error;

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
    setData(prev => ({ ...prev, expenses: prev.expenses.filter(e => e.id !== expenseId) }));
    notifySplit({
      event: 'expense_deleted',
      group_id: groupId,
      group_name: groupName,
      actor_name: actorName,
      actor_user_id: actorUserId,
      expense_title: expenseToDelete?.title ?? '',
    });
  }, [expenses, setData, groupId, groupName, actorName, actorUserId]);

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
    setData(prev => ({ ...prev, settlements: prev.settlements.filter(s => s.id !== settlementId) }));
  }, [setData]);

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
