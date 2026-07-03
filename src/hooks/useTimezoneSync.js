import { useEffect, useRef } from 'react';
import { useReminderSettings } from '@/hooks/useReminderSettings';
import { useAuth } from '@/hooks/useAuth';

/**
 * 靜默時區同步
 *
 * 用戶跨時區旅行時（例如台灣 -> 日本），簽到提醒仍會用當初儲存的時區發送，
 * 導致提醒在錯誤時間送達、錯過當天簽到。此 hook 在 App 載入時偷偷比對
 * 「資料庫儲存的時區」與「裝置當前時區」，若不同就自動更新，完全不驚動用戶。
 *
 * - 僅在提醒已啟用（enabled）時才會同步，關閉提醒的用戶不受影響
 * - 僅在時區真的改變時才寫入 DB，一般情況零寫入
 * - 重用 useReminderSettings，更新後設定頁面與 module cache 會一併同步
 */
export function useTimezoneSync() {
  const { session } = useAuth();
  const { reminderSettings, loading, loadReminderSettings, saveReminderSettings } = useReminderSettings();
  const syncedRef = useRef(false);

  // 1. 登入後觸發一次載入（拿到資料庫的真實設定）
  useEffect(() => {
    if (session) loadReminderSettings();
  }, [session, loadReminderSettings]);

  // 2. 載入完成後才比對時區，避免使用尚未載入的預設值
  useEffect(() => {
    if (!session || loading || syncedRef.current) return;

    const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (reminderSettings.enabled && deviceTz && deviceTz !== reminderSettings.timezone) {
      syncedRef.current = true; // 標記已同步，避免更新後 state 變化再次觸發
      saveReminderSettings({ ...reminderSettings, timezone: deviceTz }).catch(() => {
        // 靜默失敗，下次 App 載入會再嘗試
        syncedRef.current = false;
      });
    }
  }, [session, loading, reminderSettings, saveReminderSettings]);
}
