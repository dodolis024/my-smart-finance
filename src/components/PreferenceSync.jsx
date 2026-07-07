import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTheme, THEMES } from '@/hooks/useTheme';

const PREF_KEY = 'ui_preferences';

/**
 * Bridges local UI preferences (language + theme) with Supabase so they follow
 * the account across devices. localStorage stays the fast local cache; Supabase
 * is the source of truth once a row exists.
 *
 * Renders nothing. Must live inside AuthProvider (to read useAuth); AuthProvider
 * itself sits inside LanguageProvider/ThemeProvider so useLanguage/useTheme also
 * resolve here — this bridge avoids reordering those providers.
 *
 * Shuffle (random-theme) settings stay device-local by design: while shuffle is
 * on the theme rotates automatically, so we never sync those rotations.
 */
export default function PreferenceSync() {
  const { user } = useAuth();
  const { lang, setLang } = useLanguage();
  const { theme, setTheme, shuffleEnabled } = useTheme();

  const syncedUserRef = useRef(null);          // user id we've already hydrated for
  const hydratedRef = useRef(false);           // gate write-back until first fetch done
  const applyingFromServerRef = useRef(false); // suppress the write caused by applying server values
  const lastSyncedThemeRef = useRef(theme);    // last theme persisted to Supabase (survives shuffle)
  const prevLangRef = useRef(lang);
  const prevThemeRef = useRef(theme);

  // 1) On login: fetch server prefs, apply (server wins) or migrate local up.
  useEffect(() => {
    const userId = user?.id ?? null;

    if (!userId) {
      // Logged out — reset so the next login re-hydrates.
      syncedUserRef.current = null;
      hydratedRef.current = false;
      return;
    }
    if (syncedUserRef.current === userId) return; // already hydrated for this user

    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('settings')
        .select('value')
        .eq('user_id', userId)
        .eq('key', PREF_KEY)
        .maybeSingle();
      if (cancelled) return;

      const pref = data?.value;
      if (pref && (pref.lang || pref.theme)) {
        // Server wins. Only flip the guard if a setter will actually change state.
        const willChangeLang = pref.lang && pref.lang !== lang;
        const willChangeTheme =
          !shuffleEnabled && pref.theme && THEMES.includes(pref.theme) && pref.theme !== theme;
        if (willChangeLang || willChangeTheme) {
          applyingFromServerRef.current = true;
          if (willChangeLang) setLang(pref.lang);
          if (willChangeTheme) setTheme(pref.theme);
        }
        if (pref.theme) lastSyncedThemeRef.current = pref.theme;
      } else {
        // No row yet (existing user's first login here) — migrate local values up.
        await supabase.from('settings').upsert(
          { user_id: userId, key: PREF_KEY, value: { lang, theme } },
          { onConflict: 'user_id,key' }
        );
        lastSyncedThemeRef.current = theme;
      }

      syncedUserRef.current = userId;
      hydratedRef.current = true;
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // 2) On user-initiated change: write back to Supabase.
  useEffect(() => {
    const langChanged = lang !== prevLangRef.current;
    const themeChanged = theme !== prevThemeRef.current;
    prevLangRef.current = lang;
    prevThemeRef.current = theme;

    if (!user?.id || !hydratedRef.current) return;

    // Skip the write triggered by applying server values in step 1.
    if (applyingFromServerRef.current) {
      applyingFromServerRef.current = false;
      return;
    }

    // Theme rotations while shuffle owns the theme are not user intent — ignore.
    const meaningfulThemeChange = themeChanged && !shuffleEnabled;
    if (!langChanged && !meaningfulThemeChange) return;

    if (meaningfulThemeChange) lastSyncedThemeRef.current = theme;
    // Always persist both fields (preserving the last manually-chosen theme so a
    // language-only change during shuffle never drops it).
    const value = { lang, theme: lastSyncedThemeRef.current ?? theme };

    supabase.from('settings').upsert(
      { user_id: user.id, key: PREF_KEY, value },
      { onConflict: 'user_id,key' }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, theme]);

  return null;
}
