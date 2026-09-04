import { createContext, useState, useEffect, useCallback } from 'react';
import { supabase, createDefaultData } from '@/lib/supabase';
import { clearAllCaches } from '@/lib/resourceCache';
import { clearUserCache } from '@/lib/offlineCache';
import { clearQueue } from '@/lib/offlineQueue';

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
    if (user?.id) {
      clearQueue(user.id);
      clearUserCache(user.id);
    }
    await supabase.auth.signOut();
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

