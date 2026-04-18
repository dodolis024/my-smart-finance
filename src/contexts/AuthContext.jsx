import { createContext, useState, useEffect, useCallback } from 'react';
import { supabase, createDefaultData } from '@/lib/supabase';

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
    } = supabase.auth.onAuthStateChange((_event, session) => {
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

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

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
    signOut,
    ensureDefaultDataForOAuth,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

