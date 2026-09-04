import { useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { notifySplit } from '@/lib/splitNotify';
import { useCachedResource } from '@/hooks/useCachedResource';

export function useSplitGroups() {
  const { user } = useAuth();
  const { t } = useLanguage();

  const {
    data: groups,
    setData: setGroups,
    loading,
    load: fetchGroups,
  } = useCachedResource('split_groups', {
    userId: user?.id,
    initial: [],
    fetcher: async () => {
      const { data, error } = await supabase
        .from('split_groups')
        .select(`
          *,
          split_members ( id, name, user_id )
        `)
        .order('created_at', { ascending: false })
        // 成員順序決定均分的零頭給誰（AddExpenseModal 的 participants 就是這個順序）。
        // 不明講排序就是拿 PostgREST 的預設順序，跟 CLI 的 created_at 可能不一致，
        // 同一筆除不盡的費用兩邊會差一分錢，且只在除不盡時出現。
        .order('created_at', { referencedTable: 'split_members', ascending: true });
      if (error) throw error;

      // 為所有含已連結成員的群組一次取得頭像（單一批次 RPC，避免逐群組 N 次往返）
      const linkedGroupIds = (data || [])
        .filter(g => g.split_members?.some(m => m.user_id))
        .map(g => g.id);

      // 頭像與置頂互不相依，一起發出去省一趟往返（置頂由 RLS 限定只回自己的記錄）
      const [
        { data: avatars, error: avatarError },
        { data: pins, error: pinError },
      ] = await Promise.all([
        linkedGroupIds.length
          ? supabase.rpc('get_split_member_avatars_batch', { p_group_ids: linkedGroupIds })
          : Promise.resolve({ data: [], error: null }),
        supabase.from('split_group_pins').select('group_id, pinned_at'),
      ]);

      // 頭像是加值資訊，抓不到就退回首字母，不該讓整個群組列表載入失敗。
      // 但一定要留痕跡：靜默失敗的畫面跟「大家本來就沒設頭像」完全一樣，無從查起。
      if (avatarError) console.warn('[useSplitGroups] 取得成員頭像失敗:', avatarError.message);
      const avatarMap = {};
      (avatars || []).forEach(a => { avatarMap[`${a.group_id}:${a.member_id}`] = a.avatar_url; });

      // 同理，置頂抓不到就一律當作未置頂，列表照舊呈現
      if (pinError) console.warn('[useSplitGroups] 取得置頂群組失敗:', pinError.message);
      const pinMap = {};
      (pins || []).forEach(p => { pinMap[p.group_id] = p.pinned_at; });

      return (data || []).map(g => ({
        ...g,
        pinned_at: pinMap[g.id] || null,
        split_members: (g.split_members || []).map(m => ({
          ...m,
          avatar_url: avatarMap[`${g.id}:${m.id}`] || null,
        })),
      }));
    },
  });

  const createGroup = useCallback(async ({ name, description, currency, defaultExpenseCurrency, myName, extraMembers }) => {
    if (!user) throw new Error(t('auth.loginRequired'));

    // 建立群組
    const { data: group, error: groupError } = await supabase
      .from('split_groups')
      .insert({
        owner_id: user.id,
        name,
        description: description || null,
        currency: currency || 'TWD',
        default_expense_currency: defaultExpenseCurrency || null,
      })
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
  }, [user, fetchGroups, t]);

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
  }, [setGroups]);

  const archiveGroup = useCallback(
    (groupId) => updateGroup(groupId, { archived_at: new Date().toISOString() }),
    [updateGroup]
  );

  const unarchiveGroup = useCallback(
    (groupId) => updateGroup(groupId, { archived_at: null }),
    [updateGroup]
  );

  // 置頂是個人偏好，存在 split_group_pins（每人一份），不會影響同群組的其他成員
  const togglePin = useCallback(async (groupId) => {
    if (!user) throw new Error(t('auth.loginRequired'));
    const isPinned = Boolean(groups.find(g => g.id === groupId)?.pinned_at);

    if (isPinned) {
      const { error } = await supabase
        .from('split_group_pins')
        .delete()
        .eq('user_id', user.id)
        .eq('group_id', groupId);
      if (error) throw error;
      setGroups(prev => prev.map(g => g.id === groupId ? { ...g, pinned_at: null } : g));
      return;
    }

    const pinnedAt = new Date().toISOString();
    const { error } = await supabase
      .from('split_group_pins')
      .upsert({ user_id: user.id, group_id: groupId, pinned_at: pinnedAt });
    if (error) throw error;
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, pinned_at: pinnedAt } : g));
  }, [groups, user, setGroups, t]);

  const deleteGroup = useCallback(async (groupId) => {
    const { error } = await supabase
      .from('split_groups')
      .delete()
      .eq('id', groupId);
    if (error) throw error;
    setGroups(prev => prev.filter(g => g.id !== groupId));
  }, [setGroups]);

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
      member_id: data?.id,
      member_name: name.trim(),
    });
    return data;
  }, [groups, user, setGroups]);

  const updateMemberName = useCallback(async (groupId, memberId, newName) => {
    const trimmed = newName.trim();
    if (!trimmed) throw new Error(t('split.nameEmpty'));
    const { error } = await supabase
      .from('split_members')
      .update({ name: trimmed })
      .eq('id', memberId);
    if (error) throw error;
    setGroups(prev => prev.map(g =>
      g.id === groupId
        ? { ...g, split_members: (g.split_members || []).map(m => m.id === memberId ? { ...m, name: trimmed } : m) }
        : g
    ));
  }, [setGroups, t]);

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
  }, [groups, user, setGroups]);

  // 用邀請代碼查詢群組（RPC，任何登入用戶皆可）
  const getGroupByCode = useCallback(async (code) => {
    const { data, error } = await supabase.rpc('get_group_by_invite_code', { p_code: code });
    if (error) throw error;
    return data;
  }, []);

  // 連結自己的帳號到某個成員位置（透過 RPC 繞過 RLS）
  const linkSelfToMember = useCallback(async (memberId) => {
    if (!user) throw new Error(t('auth.loginRequired'));
    const { error } = await supabase.rpc('link_self_to_split_member', { p_member_id: memberId });
    if (error) throw error;
    await fetchGroups();
  }, [user, fetchGroups, t]);

  // 新增自己為群組新成員並連結帳號（透過 RPC 繞過 RLS，傳邀請碼而非 group_id）
  const joinGroupAsNewMember = useCallback(async (inviteCode, name) => {
    if (!user) throw new Error(t('auth.loginRequired'));
    const { data, error } = await supabase.rpc('join_split_group_as_new_member', {
      p_invite_code: inviteCode,
      p_name: name.trim(),
    });
    if (error) throw error;
    await fetchGroups();
    return data;
  }, [user, fetchGroups, t]);

  return {
    groups,
    loading,
    fetchGroups,
    createGroup,
    updateGroup,
    archiveGroup,
    unarchiveGroup,
    togglePin,
    deleteGroup,
    addMember,
    updateMemberName,
    removeMember,
    getGroupByCode,
    linkSelfToMember,
    joinGroupAsNewMember,
  };
}
