import { supabase } from '@/lib/supabase';

/**
 * 裝置推播訂閱的共用狀態、登出清理與登入還原。
 *
 * 放在 lib 而不是 usePushNotifications：登出流程（AuthContext）也要用，
 * 但 AuthContext 不能 import 那支 hook——usePushNotifications → useAuth → AuthContext
 * 會繞回來變成循環相依。
 */

// 訂閱狀態的跨實例同步：設定面板的「裝置推播」與「信用卡通知」兩區各自呼叫 usePushNotifications，
// 若各持一份 state，按下開關後另一區的提示不會更新，要重開設定才對得上。
// 與 useDashboard 的 defaultCurrencyListeners、offlineQueue 的 subscribeQueue 同一模式。
let subscribedState = false;
const listeners = new Set();

export function getPushSubscribed() {
  return subscribedState;
}

export function setPushSubscribed(value) {
  subscribedState = value;
  listeners.forEach((l) => l(value));
}

export function subscribeToPushState(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// 「這個帳號在這台裝置上開過通知」——登出後用來判斷該不該自動接回去。
// 綁 userId：瀏覽器的推播授權是整個網站共用的，沒有這個旗標就無從分辨
// 「本人回來了」與「換一個人登入」，後者不該被自動開通知。
const PUSH_ENABLED_PREFIX = 'push-enabled';

function enabledKey(userId) {
  return `${PUSH_ENABLED_PREFIX}:${userId}`;
}

export function rememberPushEnabled(userId) {
  if (!userId) return;
  try { localStorage.setItem(enabledKey(userId), '1'); } catch { /* 隱私模式寫不進去，退化成登入後要自己再開一次 */ }
}

export function forgetPushEnabled(userId) {
  if (!userId) return;
  try { localStorage.removeItem(enabledKey(userId)); } catch { /* 同上，讀不到就當作沒開過 */ }
}

function wasPushEnabled(userId) {
  try { return localStorage.getItem(enabledKey(userId)) === '1'; } catch { return false; }
}

function pushSupported() {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    && typeof window !== 'undefined' && 'PushManager' in window;
}

/** 取這台裝置目前的瀏覽器推播訂閱；沒註冊過 Service Worker 就回 null */
async function currentSubscription() {
  // 用 getRegistration 而不是 ready：沒有註冊過時 ready 會永遠 pending，
  // 登出就卡在這裡不動了
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

// 登出不該被推播清理拖住：網路慢或 Service Worker 沒回應時，
// 寧可留下一筆待清的訂閱，也不能讓使用者按了登出卡在原地
const CLEAR_TIMEOUT_MS = 3000;

/**
 * 登出時解除這台裝置「對這個帳號」的推播訂閱。
 *
 * 只刪 push_subscriptions 那一筆，瀏覽器訂閱刻意保留：解除掉的話，同一個人
 * 登入回來得再去設定裡開一次通知，等於拿使用者的麻煩換乾淨。
 * 保留訂閱、只拿掉歸屬，restorePushSubscription 就能在他回來時無聲接回去。
 *
 * 不清的後果不只是收不到：upsert 的衝突鍵是 (user_id, endpoint)，同一台裝置
 * 換帳號登入不會覆蓋舊那筆而是多一筆，這台裝置從此會同時收到兩個帳號的通知，
 * 且舊帳號登出多久都不會停。
 */
export async function clearPushSubscription(userId) {
  if (!userId || !pushSupported()) return;

  const clear = async () => {
    const sub = await currentSubscription();
    if (sub) {
      const { error } = await supabase
        .from('push_subscriptions')
        .delete()
        .eq('user_id', userId)
        .eq('endpoint', sub.endpoint);
      if (error) throw error;
    }
    setPushSubscribed(false);
  };

  try {
    await Promise.race([
      clear(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), CLEAR_TIMEOUT_MS)),
    ]);
  } catch (err) {
    // 靜默失敗會讓殘留訂閱查無可查，但也不該擋下登出
    console.warn('[pushSubscription] 登出時清除推播訂閱失敗:', err.message);
  }
}

/**
 * 登入後把這台裝置的推播訂閱接回這個帳號。
 *
 * 只在這個帳號自己開過通知時才接，換一個人登入不會被自動開——
 * 瀏覽器的推播授權是整個網站共用的，光看授權狀態分不出是誰。
 */
export async function restorePushSubscription(userId) {
  if (!userId || !pushSupported() || !wasPushEnabled(userId)) return;

  try {
    const sub = await currentSubscription();
    if (!sub) return;

    const { endpoint, keys: { p256dh, auth } } = sub.toJSON();
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert({ user_id: userId, endpoint, p256dh, auth }, { onConflict: 'user_id,endpoint' });
    if (error) throw error;

    setPushSubscribed(true);
  } catch (err) {
    // 接不回去只是這台裝置暫時收不到通知，不該影響登入
    console.warn('[pushSubscription] 登入時還原推播訂閱失敗:', err.message);
  }
}
