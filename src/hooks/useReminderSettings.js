import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

const DEFAULT_SETTINGS = {
  enabled: false,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Taipei',
  time: '20:00',
};

const SETTINGS_KEY = 'reminder_settings';

// Module-level cache
let cachedSettings = null;

export function useReminderSettings() {
  const [reminderSettings, setReminderSettings] = useState(() =>
    cachedSettings || DEFAULT_SETTINGS
  );
  const [loading, setLoading] = useState(() => !cachedSettings);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    cachedSettings = reminderSettings;
  }, [reminderSettings]);

  const loadReminderSettings = useCallback(async () => {
    if (!cachedSettings) setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('settings')
        .select('value')
        .eq('user_id', user.id)
        .eq('key', SETTINGS_KEY)
        .single();

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
  }, []);

  const saveReminderSettings = useCallback(async (settings) => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('請先登入');

      const { error } = await supabase.from('settings').upsert(
        { user_id: user.id, key: SETTINGS_KEY, value: settings },
        { onConflict: 'user_id,key' }
      );

      if (error) throw error;
      setReminderSettings(settings);
    } finally {
      setSaving(false);
    }
  }, []);

  return {
    reminderSettings,
    loading,
    saving,
    loadReminderSettings,
    saveReminderSettings,
  };
}
