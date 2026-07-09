import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { useCachedResource } from '@/hooks/useCachedResource';

const DEFAULT_SETTINGS = {
  payment_reminder_enabled: false,
  payment_days_before: 3,
  usage_alert_enabled: false,
  usage_warn_threshold: 80,
};

const SETTINGS_KEY = 'credit_card_notification_settings';

export function useCreditCardNotificationSettings() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [saving, setSaving] = useState(false);

  const {
    data: settings,
    setData: setSettings,
    loading,
    load: loadSettings,
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
        return DEFAULT_SETTINGS;
      } catch {
        // 沿用原本行為：載入失敗時保留現值、不覆寫（不對呼叫端拋錯）
        return settings;
      }
    },
  });

  const saveSettings = useCallback(async (newSettings) => {
    setSaving(true);
    try {
      if (!user) throw new Error(t('auth.loginRequired'));

      const { error } = await supabase.from('settings').upsert(
        { user_id: user.id, key: SETTINGS_KEY, value: newSettings },
        { onConflict: 'user_id,key' }
      );

      if (error) throw error;
      setSettings(newSettings);
    } finally {
      setSaving(false);
    }
  }, [user, t, setSettings]);

  return {
    settings,
    loading,
    saving,
    loadSettings,
    saveSettings,
  };
}
