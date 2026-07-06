import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';

const DEFAULT_SETTINGS = {
  enabled: false,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Taipei',
  time: '20:00',
};

const SETTINGS_KEY = 'reminder_settings';

// Module-level cache（以 userId 綁定，避免同瀏覽器切換帳號時沿用他人的設定）
let cachedSettings = null;
let cachedUserId = null;

export function useReminderSettings() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const hasCached = cachedSettings && cachedUserId === user?.id;
  const [reminderSettings, setReminderSettings] = useState(() =>
    hasCached ? cachedSettings : DEFAULT_SETTINGS
  );
  const [loading, setLoading] = useState(() => !hasCached);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    cachedSettings = reminderSettings;
    cachedUserId = user?.id ?? null;
  }, [reminderSettings, user?.id]);

  const loadReminderSettings = useCallback(async () => {
    if (!user) return;
    if (!(cachedSettings && cachedUserId === user.id)) setLoading(true);
    try {
      const { data, error } = await supabase
        .from('settings')
        .select('value')
        .eq('user_id', user.id)
        .eq('key', SETTINGS_KEY)
        .maybeSingle();

      if (!error && data?.value) {
        setReminderSettings({ ...DEFAULT_SETTINGS, ...data.value });
      } else {
        setReminderSettings({
          ...DEFAULT_SETTINGS,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Taipei',
        });
      }
    } catch {
      // No saved settings yet, use defaults
    } finally {
      setLoading(false);
    }
  }, [user]);

  const saveReminderSettings = useCallback(async (settings) => {
    setSaving(true);
    try {
      if (!user) throw new Error(t('auth.loginRequired'));

      const { error } = await supabase.from('settings').upsert(
        { user_id: user.id, key: SETTINGS_KEY, value: settings },
        { onConflict: 'user_id,key' }
      );

      if (error) throw error;
      setReminderSettings(settings);
    } finally {
      setSaving(false);
    }
  }, [user, t]);

  return {
    reminderSettings,
    loading,
    saving,
    loadReminderSettings,
    saveReminderSettings,
  };
}
