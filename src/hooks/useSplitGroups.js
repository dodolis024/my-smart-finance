import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { notifySplit } from '@/lib/splitNotify';

// Module-level cache — survives component unmount/remount
let cachedGroups = null;
let cachedUserId = null;

export function useSplitGroups() {
  const { user, userInfo } = useAuth();
  // Initialise from cache if same user
  const [groups, setGroups] = useState(() =>
    (cachedGroups && cachedUserId === user?.id) ? cachedGroups : []
  );
  const [loading, setLoading] = useState(() =>
    !(cachedGroups && cachedUserId === user?.id)
  );

  // Keep module cache in sync
  useEffect(() => {
    cachedGroups = groups;
    cachedUserId = user?.id ?? null;
  }, [groups, user?.id]);

  const fetchGroups = useCallback(async () => {
    if (!user) return;
    // Only show loading spinner when there's no cached data
    if (!cachedGroups || cachedUserId !== user.id) setLoading(true);
    try {
      const { data, error } = await supabase
        .from('split_groups')
        .select(`
          *,
          split_members ( id, name, user_id )
        `)
        .order('created_at', { ascending: false });
      if (error) throw error;

      // 為每個群組的已連結成員取得頭像
      const groupsWithAvatars = await Promise.all(
        (data || []).map(async (g) => {
          const hasLinkedMembers = g.split_members?.some(m => m.user_id);
          if (!hasLinkedMembers) return g;

          const { data: avatars } = await supabase.rpc('get_split_member_avatars', { p_group_id: g.id });
          if (!avatars?.length) return g;

          const avatarMap = {};
          avatars.forEach(a => { avatarMap[a.member_id] = a.avatar_url; });

          return {
            ...g,
            split_members: g.split_members.map(m => ({
              ...m,
              avatar_url: avatarMap[m.id] || null,
            })),
          };
        })
      );

      setGroups(groupsWithAvatars);
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

  const updateGroup = useCallback(async (groupId, updates) => {
    const { data, error } = await supabase
      .from('split_groups')
      .update(updates)
      .eq('id', groupId)
      .select()
      .single();
    if (error) throw error;
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, ...data } : g));
    return data;
  }, []);

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
    const currentGroup = groups.find(g => g.id === groupId);
    const actorMember = currentGroup?.split_members?.find(m => m.user_id === user?.id);
    notifySplit({
      event: 'member_added',
      group_id: groupId,
      group_name: currentGroup?.name ?? '',
      actor_name: actorMember?.name ?? '',
      actor_user_id: user?.id,
      member_name: name.trim(),
    });
    return data;
  }, [groups, user]);

  const removeMember = useCallback(async (groupId, memberId) => {
    const currentGroup = groups.find(g => g.id === groupId);
    const memberToRemove = currentGroup?.split_members?.find(m => m.id === memberId);
    const actorMember = currentGroup?.split_members?.find(m => m.user_id === user?.id);
    const { error } = await supabase
      .from('split_members')
      .delete()
      .eq('id', memberId);
    if (error) throw error;
    setGroups(prev => prev.map(g =>
      g.id === groupId
        ? { ...g, split_members: (g.split_members || []).filter(m => m.id !== memberId) }
        : g
    ));
    notifySplit({
      event: 'member_removed',
      group_id: groupId,
      group_name: currentGroup?.name ?? '',
      actor_name: actorMember?.name ?? '',
      actor_user_id: user?.id,
      member_name: memberToRemove?.name ?? '',
    });
  }, [groups, user]);

  // 用邀請代碼查詢群組（RPC，任何登入用戶皆可）
  const getGroupByCode = useCallback(async (code) => {
    const { data, error } = await supabase.rpc('get_group_by_invite_code', { p_code: code });
    if (error) throw error;
    return data;
  }, []);

  // 連結自己的帳號到某個成員位置（透過 RPC 繞過 RLS）
  const linkSelfToMember = useCallback(async (memberId) => {
    if (!user) throw new Error('請先登入');
    const { error } = await supabase.rpc('link_self_to_split_member', { p_member_id: memberId });
    if (error) throw error;
    await fetchGroups();
  }, [user, fetchGroups]);

  // 新增自己為群組新成員並連結帳號（透過 RPC 繞過 RLS，傳邀請碼而非 group_id）
  const joinGroupAsNewMember = useCallback(async (inviteCode, name) => {
    if (!user) throw new Error('請先登入');
    const { data, error } = await supabase.rpc('join_split_group_as_new_member', {
      p_invite_code: inviteCode,
      p_name: name.trim(),
    });
    if (error) throw error;
    await fetchGroups();
    return data;
  }, [user, fetchGroups]);

  return {
    groups,
    loading,
    fetchGroups,
    createGroup,
    updateGroup,
    deleteGroup,
    addMember,
    removeMember,
    getGroupByCode,
    linkSelfToMember,
    joinGroupAsNewMember,
  };
}
