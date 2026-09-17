import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { getNowHm } from '@/lib/utils';

export function useSplitSync(groupId) {
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const fetchSyncStatus = useCallback(async () => {
    if (!groupId) return;
    const { data, error } = await supabase.rpc('get_split_sync_status', {
      p_group_id: groupId,
    });
    if (!error && data) setSyncStatus(data);
  }, [groupId]);

  const syncToLedger = useCallback(async () => {
    if (!groupId) return { success: false };
    setSyncing(true);
    try {
      // 新建交易的時間帶裝置本地時間，與手動記帳同一個時鐘；
      // 不帶的話資料庫只能用自己的時鐘，而它是 UTC
      const { data, error } = await supabase.rpc('sync_split_to_ledger', {
        p_group_id: groupId,
        p_time: getNowHm(),
      });
      if (error) throw error;
      await fetchSyncStatus();
      return data;
    } finally {
      setSyncing(false);
    }
  }, [groupId, fetchSyncStatus]);

  return { syncStatus, syncing, fetchSyncStatus, syncToLedger };
}
