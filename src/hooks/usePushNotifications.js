import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { getPushSubscribed, setPushSubscribed, subscribeToPushState, rememberPushEnabled, forgetPushEnabled } from '@/lib/pushSubscription';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

const SW_PATH = import.meta.env.BASE_URL + 'sw.js';
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

export function usePushNotifications() {
  const { user } = useAuth();
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState('default');
  const [isSubscribed, setIsSubscribed] = useState(getPushSubscribed);
  const [loading, setLoading] = useState(false);

  useEffect(() => subscribeToPushState(setIsSubscribed), []);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (!VAPID_PUBLIC_KEY) return;

    setIsSupported(true);
    setPermission(Notification.permission);

    // 檢查目前裝置是否已訂閱
    // PROD 由 main.jsx 於啟動時註冊,這裡等 ready 即可;dev 環境沒人註冊,補註冊一次
    const regPromise = import.meta.env.PROD
      ? navigator.serviceWorker.ready
      : navigator.serviceWorker.register(SW_PATH);
    regPromise.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        setPushSubscribed(!!sub);
      });
    }).catch(() => {});
  }, []);

  const subscribe = useCallback(async () => {
    if (!user || !isSupported) return;
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      const json = sub.toJSON();
      const { endpoint, keys: { p256dh, auth } } = json;

      const { error } = await supabase
        .from('push_subscriptions')
        .upsert({ user_id: user.id, endpoint, p256dh, auth }, { onConflict: 'user_id,endpoint' });

      if (error) throw error;

      // 記住這個帳號在這台裝置開過通知，登出再登入時才接得回去
      rememberPushEnabled(user.id);
      setPushSubscribed(true);
      setPermission(Notification.permission);
    } catch (err) {
      console.error('[PushNotifications] subscribe failed:', err);
      setPermission(Notification.permission);
    } finally {
      setLoading(false);
    }
  }, [user, isSupported]);

  const unsubscribe = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        // 先刪資料庫再解除瀏覽器訂閱：反過來的話，刪除失敗就會留下一筆
        // 對不到任何裝置的訂閱，通知照送但誰也收不到，且沒有依據能再刪
        const { error } = await supabase
          .from('push_subscriptions')
          .delete()
          .eq('user_id', user.id)
          .eq('endpoint', sub.endpoint);
        if (error) throw error;
        await sub.unsubscribe();
      }
      // 主動關閉才清旗標：登出走的是 clearPushSubscription，那條路要留著旗標
      forgetPushEnabled(user.id);
      setPushSubscribed(false);
    } catch (err) {
      console.error('[PushNotifications] unsubscribe failed:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  return { isSupported, permission, isSubscribed, loading, subscribe, unsubscribe };
}
