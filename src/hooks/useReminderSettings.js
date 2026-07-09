import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { useCachedResource } from '@/hooks/useCachedResource';

const DEFAULT_SETTINGS = {
  enabled: false,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Taipei',
  time: '20:00',
};

const SETTINGS_KEY = 'reminder_settings';

export function useReminderSettings() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [saving, setSaving] = useState(false);

  const {
    data: reminderSettings,
    setData: setReminderSettings,
    loading,
    load: loadReminderSettings,
  } = useCachedResource(SETTINGS_KEY, {
    userId: user?.id,
    initial: DEFAULT_SETTINGS,
    fetcher: async () => {
      try {
        const { data, error } = await supabase
          .from('settings')
          .select('value')
          .eq('user_id', user.id)
          .eq('key', SETTINGS_KEY)
          .maybeSingle();

        if (!error && data?.value) {
          return { ...DEFAULT_SETTINGS, ...data.value };
        }
        return {
          ...DEFAULT_SETTINGS,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Taipei',
        };
      } catch {
        // 沿用原本行為：載入失敗時保留現值、不覆寫（不對呼叫端拋錯）
        return reminderSettings;
      }
    },
  });

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
  }, [user, t, setReminderSettings]);

  return {
    reminderSettings,
    loading,
    saving,
    loadReminderSettings,
    saveReminderSettings,
  };
}
