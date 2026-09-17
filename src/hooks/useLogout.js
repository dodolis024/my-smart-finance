import { useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useToast } from '@/contexts/ToastContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { listQueue } from '@/lib/offlineQueue';

/**
 * 登出流程:登出會連同離線快取與未送出的記帳佇列一起清掉(見 AuthContext.signOut),
 * 所以佇列還有東西時要先把筆數講清楚,不能讓使用者無聲掉帳。
 * 登出失敗(多半是斷線)時什麼都沒清,要明講,不然使用者會以為已經登出。
 * 側邊欄與頭像選單共用同一份,避免兩邊的提示條件走鐘。
 */
export function useLogout() {
  const { user, signOut } = useAuth();
  const { confirm } = useConfirm();
  const toast = useToast();
  const { t } = useLanguage();

  return useCallback(async () => {
    const pending = listQueue(user?.id).length;
    const message = pending > 0
      ? t('auth.logoutConfirmPending', { count: pending })
      : t('auth.logoutConfirm');
    if (!(await confirm(message))) return;
    try {
      await signOut();
    } catch (err) {
      console.error('[useLogout] sign out failed:', err);
      toast.error(t('auth.logoutFailed'));
    }
  }, [user, signOut, confirm, toast, t]);
}
