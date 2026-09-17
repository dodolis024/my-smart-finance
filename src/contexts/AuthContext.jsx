import { createContext, useState, useEffect, useCallback } from 'react';
import { supabase, createDefaultData } from '@/lib/supabase';
import { clearAllCaches } from '@/lib/resourceCache';
import { clearUserCache } from '@/lib/offlineCache';
import { clearQueue } from '@/lib/offlineQueue';
import { clearPushSubscription, restorePushSubscription } from '@/lib/pushSubscription';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [userInfo, setUserInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  const extractUserInfo = useCallback((user) => {
    if (!user) return null;
    const provider = user.app_metadata?.provider || user.identities?.[0]?.provider || 'email';
    const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture || null;
    return {
      email: user.email || '',
      provider,
      avatarUrl,
      fullName: user.user_metadata?.full_name || user.user_metadata?.name || null,
    };
  }, []);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        setSession(session);
        setUser(session?.user ?? null);
        setUserInfo(extractUserInfo(session?.user ?? null));
      })
      .catch(() => {
        /* network error — stay logged out */
      })
      .finally(() => setLoading(false));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // 登出時清空所有以 userId 綁定的資源快取，避免前一位使用者的資料續留記憶體
      if (event === 'SIGNED_OUT') clearAllCaches();
      setSession(session);
      setUser(session?.user ?? null);
      setUserInfo(extractUserInfo(session?.user ?? null));
    });

    return () => subscription.unsubscribe();
  }, [extractUserInfo]);

  // 登入後把這台裝置的推播訂閱接回這個帳號：登出時只解除了資料庫那筆歸屬，
  // 瀏覽器訂閱刻意留著，同一個人回來就自動恢復，不必再去設定裡開一次
  useEffect(() => {
    if (user?.id) restorePushSubscription(user.id);
  }, [user?.id]);

  const signInWithPassword = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    if (data?.session) {
      setSession(data.session);
      setUser(data.session.user);
      setUserInfo(extractUserInfo(data.session.user));
    }

    return data;
  }, [extractUserInfo]);

  const getStoredLang = () => {
    try { return localStorage.getItem('app-lang') === 'en' ? 'en' : 'zh'; } catch { return 'zh'; }
  };

  const signUp = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    if (data.user) {
      await createDefaultData(data.user.id, getStoredLang());
    }
    return data;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const redirectTo = window.location.origin + import.meta.env.BASE_URL;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (error) throw error;
  }, []);

  const sendPasswordReset = useCallback(async (email) => {
    const redirectTo = window.location.origin + import.meta.env.BASE_URL + 'reset-password';
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
  }, []);

  const updatePassword = useCallback(async (newPassword) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  }, []);

  // 只清「使用者主動登出」這條路徑:共用裝置上,下一個人不該在離線快取裡
  // 看到上一位的帳目。session 過期造成的 SIGNED_OUT 刻意不清,那時佇列要留著
  // 等重新登入補送(見 offlineQueue 的 needsLogin 分支)。
  // 未同步佇列會一併丟棄,呼叫端(useLogout)負責先向使用者確認筆數。
  const signOut = useCallback(async () => {
    // 登出成功會觸發 SIGNED_OUT 把 user 設成 null，清理要用的 id 先存起來
    const userId = user?.id;
    if (userId) {
      // 必須趕在 signOut 之前：刪 push_subscriptions 要通過 RLS，
      // session 一沒了就刪不動，那筆訂閱會留著繼續把通知推到這台裝置
      await clearPushSubscription(userId);
    }
    // 斷線時 supabase 只回傳 error、不清本機 session（人還登入著），
    // 所以佇列與快取要等確定登出了才清，否則會變成「沒登出、帳卻沒了」
    const { error } = await supabase.auth.signOut();
    if (error) {
      // 沒登出成功、人還在，剛刪掉的推播歸屬要立刻接回來；否則要等下次重新載入
      // （restorePushSubscription 只在 user.id 改變時跑）這台裝置才會再收到通知
      if (userId) await restorePushSubscription(userId);
      throw error;
    }
    if (userId) {
      clearQueue(userId);
      clearUserCache(userId);
    }
  }, [user]);

  const ensureDefaultDataForOAuth = useCallback(async (userId) => {
    const { data: accounts } = await supabase
      .from('accounts')
      .select('id')
      .eq('user_id', userId)
      .limit(1);
    if (!accounts || accounts.length === 0) {
      await createDefaultData(userId, getStoredLang());
    }
  }, []);

  const value = {
    session,
    user,
    userInfo,
    loading,
    signInWithPassword,
    signUp,
    signInWithGoogle,
    sendPasswordReset,
    updatePassword,
    signOut,
    ensureDefaultDataForOAuth,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

