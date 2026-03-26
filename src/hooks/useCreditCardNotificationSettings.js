import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

const DEFAULT_SETTINGS = {
  payment_reminder_enabled: false,
  payment_days_before: 3,
  usage_alert_enabled: false,
  usage_warn_threshold: 80,
};

const SETTINGS_KEY = 'credit_card_notification_settings';

// Module-level cache
let cachedSettings = null;

export function useCreditCardNotificationSettings() {
  const [settings, setSettings] = useState(() => cachedSettings || DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(() => !cachedSettings);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    cachedSettings = settings;
  }, [settings]);

  const loadSettings = useCallback(async () => {
    if (!cachedSettings) setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

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
  }, []);

  const saveSettings = useCallback(async (newSettings) => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('請先登入');

      const { error } = await supabase.from('settings').upsert(
        { user_id: user.id, key: SETTINGS_KEY, value: newSettings },
        { onConflict: 'user_id,key' }
      );

      if (error) throw error;
      setSettings(newSettings);
    } finally {
      setSaving(false);
    }
  }, []);

  return {
    settings,
    loading,
    saving,
    loadSettings,
    saveSettings,
  };
}
