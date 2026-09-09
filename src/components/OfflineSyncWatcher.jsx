import { useOfflineSync } from '@/hooks/useOfflineSync';
import { useToast } from '@/contexts/ToastContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { notifyDataChanged } from '@/lib/dataEvents';

/**
 * 離線佇列自動補送的唯一擁有者。不渲染任何東西（比照 PreferenceSync）。
 *
 * 掛在 App 層而不是儀表板，是因為補送時機（回到前景、恢復連線）不該綁在某一頁：
 * 使用者停在分帳頁或年度回顧頁時網路恢復，佇列一樣要送出去。
 *
 * 補送成功後發 notifyDataChanged()，已掛載的儀表板會靜默重抓當期資料
 * （見 DashboardPage 的 subscribeDataChanged）；儀表板自己的 useOfflineSync
 * 傳 autoFlush: false，只負責合併顯示與手動重試，避免同一次補送跳兩次 toast。
 *
 * 必須放在 AuthProvider 與 ToastProvider 之內。
 */
export default function OfflineSyncWatcher() {
  const toast = useToast();
  const { t } = useLanguage();

  useOfflineSync({
    onSynced: (result) => {
      toast.success(t('dashboard.syncSuccess', { count: result.synced }));
      notifyDataChanged();
    },
    onFailed: (result) => toast.error(t('dashboard.syncFailed', { count: result.failed })),
    onNeedsLogin: () => toast.error(t('dashboard.syncNeedsLogin')),
  });

  return null;
}
