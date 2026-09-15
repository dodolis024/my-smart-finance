import { useEffect, useRef } from 'react';
import { useReminderSettings } from '@/hooks/useReminderSettings';
import { useAuth } from '@/hooks/useAuth';

const LAST_DEVICE_TZ_PREFIX = 'sf:tz:last-device:v1';

// 同一台裝置會登入多個帳號，依帳號分開記
function readLastDeviceTz(userId) {
  try {
    return localStorage.getItem(`${LAST_DEVICE_TZ_PREFIX}:${userId}`);
  } catch {
    return null;
  }
}

function writeLastDeviceTz(userId, tz) {
  try {
    localStorage.setItem(`${LAST_DEVICE_TZ_PREFIX}:${userId}`, tz);
  } catch {
    // 無痕模式或空間不足：記不住就當作沒有紀錄，下次開 App 照舊比對
  }
}

/**
 * 靜默時區同步
 *
 * 用戶跨時區旅行時（例如台灣 -> 日本），簽到提醒仍會用當初儲存的時區發送，
 * 導致提醒在錯誤時間送達、錯過當天簽到。此 hook 在 App 載入時偷偷比對
 * 「上次看到的裝置時區」與「裝置當前時區」，裝置時區真的變了才把提醒時區改成新的。
 *
 * - 只看裝置時區有沒有變，不看「存的時區 ≠ 裝置時區」：
 *   使用者在設定頁手動選了別的時區，裝置沒移動就不會被蓋回去
 * - 每個帳號每次開 App 只比對一次，之後在設定頁改時區不會再觸發
 * - 沒有紀錄時（第一次）照舊：存的時區和裝置不同就同步，然後記下來
 * - 僅在提醒已啟用（enabled）時才會同步，關閉提醒的用戶不受影響
 * - 僅在時區真的改變時才寫入 DB，一般情況零寫入
 * - 重用 useReminderSettings，更新後設定頁面與 module cache 會一併同步
 */
export function useTimezoneSync() {
  const { session, user } = useAuth();
  const { reminderSettings, loading, loadReminderSettings, saveReminderSettings } = useReminderSettings();
  const checkedUserRef = useRef(null);

  // 1. 登入後觸發一次載入（拿到資料庫的真實設定）
  useEffect(() => {
    if (session) loadReminderSettings();
  }, [session, loadReminderSettings]);

  // 2. 載入完成後才比對時區，避免使用尚未載入的預設值
  useEffect(() => {
    const userId = user?.id;
    if (!session || !userId || loading || checkedUserRef.current === userId) return;
    checkedUserRef.current = userId;

    const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!deviceTz || readLastDeviceTz(userId) === deviceTz) return;

    if (!reminderSettings.enabled || deviceTz === reminderSettings.timezone) {
      writeLastDeviceTz(userId, deviceTz);
      return;
    }
    saveReminderSettings({ ...reminderSettings, timezone: deviceTz })
      .then(() => writeLastDeviceTz(userId, deviceTz))
      .catch(() => {
        // 靜默失敗：沒記下裝置時區，下次 App 載入會再嘗試
      });
  }, [session, user?.id, loading, reminderSettings, saveReminderSettings]);
}
