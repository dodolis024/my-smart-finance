import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';

const DEFAULT_SETTINGS = {
  payment_reminder_enabled: false,
  payment_days_before: 3,
  usage_alert_enabled: false,
  usage_warn_threshold: 80,
};

const SETTINGS_KEY = 'credit_card_notification_settings';

// Module-level cache（以 userId 綁定，避免同瀏覽器切換帳號時沿用他人的設定）
let cachedSettings = null;
let cachedUserId = null;

export function useCreditCardNotificationSettings() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const hasCached = cachedSettings && cachedUserId === user?.id;
  const [settings, setSettings] = useState(() => (hasCached ? cachedSettings : DEFAULT_SETTINGS));
  const [loading, setLoading] = useState(() => !hasCached);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    cachedSettings = settings;
    cachedUserId = user?.id ?? null;
  }, [settings, user?.id]);

  const loadSettings = useCallback(async () => {
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
        setSettings({ ...DEFAULT_SETTINGS, ...data.value });
      } else {
        setSettings(DEFAULT_SETTINGS);
      }
    } catch {
      // No saved settings yet, use defaults
    } finally {
      setLoading(false);
    }
  }, [user]);

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
  }, [user, t]);

  return {
    settings,
    loading,
    saving,
    loadSettings,
    saveSettings,
  };
}
