import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTheme, THEMES } from '@/hooks/useTheme';

const PREF_KEY = 'ui_preferences';
const PENDING_PREFIX = 'sf:prefs:pending:v1';

function pendingKey(userId) {
  return `${PENDING_PREFIX}:${userId}`;
}

function readPending(userId) {
  try {
    const raw = localStorage.getItem(pendingKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writePending(userId, value) {
  try {
    localStorage.setItem(pendingKey(userId), JSON.stringify(value));
  } catch {
    // quota/private mode — write-back is still attempted, just not durable across refresh
  }
}

function clearPendingIfUnchanged(userId, value) {
  const current = readPending(userId);
  if (current && current.lang === value.lang && current.theme === value.theme) {
    try {
      localStorage.removeItem(pendingKey(userId));
    } catch {
      // ignore
    }
  }
}

/**
 * Upsert prefs to Supabase, marking the write as "pending" in localStorage first
 * so an interrupted request (e.g. the tab is refreshed mid-flight) survives reload
 * and gets retried on next mount instead of a stale server row winning hydration.
 *
 * pending 額外記錄 savedAt 時間戳（僅存在本機、不會送進 value 欄位），
 * 讓下次 hydration 能跟伺服器的 updated_at 比對新舊，避免多裝置情境下
 * 舊裝置的殘留 pending 蓋掉另一台裝置較新已同步成功的設定。
 */
async function pushPreferences(userId, value) {
  writePending(userId, { ...value, savedAt: Date.now() });
  const { error } = await supabase
    .from('settings')
    .upsert({ user_id: userId, key: PREF_KEY, value }, { onConflict: 'user_id,key' });
  if (!error) clearPendingIfUnchanged(userId, value);
}

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
      // A pending write from last session means the local choice never reached
      // Supabase (e.g. the tab was refreshed mid-request). It's *usually* newer
      // than whatever's on the server, so we'd normally retry it instead of
      // fetching and letting the stale server row overwrite the user's actual
      // choice — but with multiple devices, another device may have synced a
      // genuinely newer choice to the server *after* this pending was written
      // (e.g. this tab was left open offline). So always fetch the server row
      // (with updated_at) and compare timestamps before deciding which wins.
      const pending = readPending(userId);

      const { data } = await supabase
        .from('settings')
        .select('value, updated_at')
        .eq('user_id', userId)
        .eq('key', PREF_KEY)
        .maybeSingle();
      if (cancelled) return;

      if (pending) {
        // server 較新，才需要捨棄 pending 改走 server-wins；否則（server 沒有這筆、
        // 或 pending 是沒有 savedAt 的舊版殘留，向後相容）維持原行為重放 pending。
        const serverIsNewer =
          data?.updated_at != null &&
          pending.savedAt != null &&
          new Date(data.updated_at).getTime() > pending.savedAt;

        if (!serverIsNewer) {
          if (pending.theme) lastSyncedThemeRef.current = pending.theme;
          pushPreferences(userId, pending);
          syncedUserRef.current = userId;
          hydratedRef.current = true;
          return;
        }

        // server 較新：這筆 pending 已經過期，捨棄它，改走下面的 server-wins 套用路徑。
        try {
          localStorage.removeItem(pendingKey(userId));
        } catch {
          // ignore
        }
      }

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
        await pushPreferences(userId, { lang, theme });
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

    pushPreferences(user.id, value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, theme]);

  return null;
}
