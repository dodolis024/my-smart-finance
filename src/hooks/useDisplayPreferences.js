import { useCallback, useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useCachedResource } from '@/hooks/useCachedResource';

// 主畫面金額的顯示偏好（每位使用者一份，存在 settings 表、跨裝置同步）：
//   currency   — 加總（統計卡、每日小計、圓餅圖…）與換算後金額使用的幣別
//   amountMode — 每筆交易顯示「換算成 currency」(converted) 或「記帳時的原幣」(original)
// 與「預設記帳幣別」(default_currency) 刻意分開：那個只決定新增表單預選的幣別。
const SETTINGS_KEY = 'display_preferences';
const LOCAL_PREFIX = 'sf:display:v1';

export const AMOUNT_MODES = ['converted', 'original'];
export const DEFAULT_DISPLAY_PREFERENCES = { currency: 'TWD', amountMode: 'converted' };

/** 伺服器或 localStorage 讀回的值一律過一次，缺欄位或髒值退回預設 */
export function normalizeDisplayPreferences(value) {
  const currency =
    typeof value?.currency === 'string' && value.currency.trim()
      ? value.currency.trim().toUpperCase()
      : DEFAULT_DISPLAY_PREFERENCES.currency;
  const amountMode = AMOUNT_MODES.includes(value?.amountMode)
    ? value.amountMode
    : DEFAULT_DISPLAY_PREFERENCES.amountMode;
  return { currency, amountMode };
}

// 本機快取只為了重新整理時首屏就用對的幣別，不必等設定查回來才跳一下；
// 以 userId 分 key，同一台裝置的其他帳號不會吃到這份
function readLocal(userId) {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(`${LOCAL_PREFIX}:${userId}`);
    return raw ? normalizeDisplayPreferences(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeLocal(userId, prefs) {
  if (!userId) return;
  try {
    localStorage.setItem(`${LOCAL_PREFIX}:${userId}`, JSON.stringify(prefs));
  } catch {
    // quota 滿或隱私模式：只是少了首屏快取，伺服器仍是準
  }
}

// 存檔排隊：每次送的都是完整值，並行送出時伺服器收到的順序不保證等於點擊順序，
// 連點（例如主畫面快速切換）會讓較早的值最後寫入、蓋掉最新的選擇。
// 放在模組層級，設定頁與主畫面兩個 hook 實例共用同一條隊伍。
let saveQueue = Promise.resolve();

export function useDisplayPreferences() {
  const { user } = useAuth();
  const userId = user?.id;
  const initial = useMemo(() => readLocal(userId) || DEFAULT_DISPLAY_PREFERENCES, [userId]);

  const latestRef = useRef(initial);

  const { data: displayPreferences, setData, load } = useCachedResource(SETTINGS_KEY, {
    userId,
    initial,
    fetcher: async () => {
      try {
        const { data, error } = await supabase
          .from('settings')
          .select('value')
          .eq('user_id', userId)
          .eq('key', SETTINGS_KEY)
          .maybeSingle();
        if (error) return latestRef.current;
        return normalizeDisplayPreferences(data?.value);
      } catch {
        // 離線或查詢失敗：保留現值（本機快取或預設），不對呼叫端拋錯
        return latestRef.current;
      }
    },
  });

  latestRef.current = displayPreferences;

  useEffect(() => {
    writeLocal(userId, displayPreferences);
  }, [userId, displayPreferences]);

  // 樂觀更新：主畫面的快速切換要按下去立刻有反應；寫入失敗再退回並拋錯給呼叫端提示
  const saveDisplayPreferences = useCallback(async (patch) => {
    if (!userId) return;
    const prev = latestRef.current;
    const next = normalizeDisplayPreferences({ ...prev, ...patch });
    // 立刻更新 ref，不等重繪：同一輪內連點兩個設定時，第二次才會疊在第一次之上
    latestRef.current = next;
    setData(next);
    const request = saveQueue.then(() =>
      supabase
        .from('settings')
        .upsert({ user_id: userId, key: SETTINGS_KEY, value: next }, { onConflict: 'user_id,key' })
    );
    saveQueue = request.catch(() => {});
    const { error } = await request;
    if (error) {
      // 期間若又有新的切換（latestRef 已不是 next），就不回滾，免得蓋掉較新的選擇
      if (latestRef.current === next) setData(prev);
      throw error;
    }
  }, [userId, setData]);

  return {
    displayPreferences,
    loadDisplayPreferences: load,
    saveDisplayPreferences,
  };
}
