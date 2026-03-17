import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export function useSplitGroups() {
  const { user, userInfo } = useAuth();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchGroups = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('split_groups')
        .select(`
          *,
          split_members ( id, name, user_id )
        `)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setGroups(data || []);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const createGroup = useCallback(async ({ name, description, currency, myName, extraMembers }) => {
    if (!user) throw new Error('請先登入');

    // 建立群組
    const { data: group, error: groupError } = await supabase
      .from('split_groups')
      .insert({ owner_id: user.id, name, description: description || null, currency: currency || 'TWD' })
      .select()
      .single();
    if (groupError) throw groupError;

    // 建立者自動成為第一位成員
    const membersToInsert = [
      { group_id: group.id, name: myName, user_id: user.id },
      ...(extraMembers || []).filter(n => n.trim()).map(n => ({
        group_id: group.id,
        name: n.trim(),
        user_id: null,
      })),
    ];

    const { error: membersError } = await supabase
      .from('split_members')
      .insert(membersToInsert);
    if (membersError) throw membersError;

    await fetchGroups();
    return group;
  }, [user, fetchGroups]);

  const deleteGroup = useCallback(async (groupId) => {
    const { error } = await supabase
      .from('split_groups')
      .delete()
      .eq('id', groupId);
    if (error) throw error;
    setGroups(prev => prev.filter(g => g.id !== groupId));
  }, []);

  const addMember = useCallback(async (groupId, name) => {
    const { data, error } = await supabase
      .from('split_members')
      .insert({ group_id: groupId, name: name.trim(), user_id: null })
      .select()
      .single();
    if (error) throw error;
    setGroups(prev => prev.map(g =>
      g.id === groupId
        ? { ...g, split_members: [...(g.split_members || []), data] }
        : g
    ));
    return data;
  }, []);

  // 用邀請代碼查詢群組（RPC，任何登入用戶皆可）
  const getGroupByCode = useCallback(async (code) => {
    const { data, error } = await supabase.rpc('get_group_by_invite_code', { p_code: code });
    if (error) throw error;
    return data;
  }, []);

  // 連結自己的帳號到某個成員位置
  const linkSelfToMember = useCallback(async (memberId) => {
    if (!user) throw new Error('請先登入');
    const { error } = await supabase
      .from('split_members')
      .update({ user_id: user.id })
      .eq('id', memberId)
      .is('user_id', null);
    if (error) throw error;
    await fetchGroups();
  }, [user, fetchGroups]);

  // 新增自己為群組新成員並連結帳號
  const joinGroupAsNewMember = useCallback(async (groupId, name) => {
    if (!user) throw new Error('請先登入');
    const { data, error } = await supabase
      .from('split_members')
      .insert({ group_id: groupId, name: name.trim(), user_id: user.id })
      .select()
      .single();
    if (error) throw error;
    await fetchGroups();
    return data;
  }, [user, fetchGroups]);

  return {
    groups,
    loading,
    fetchGroups,
    createGroup,
    deleteGroup,
    addMember,
    getGroupByCode,
    linkSelfToMember,
    joinGroupAsNewMember,
  };
}
