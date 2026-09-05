import { useState, useEffect } from 'react';
import { WheelPicker, HOURS, MINUTES } from '../../wheelPicker/WheelPicker';
import { getCommonTimezones } from '../../data/commonTimezones';
import { useReminderSettings } from '@/hooks/useReminderSettings';
import { useLanguage } from '@/contexts/LanguageContext';

// 簽到提醒信：設定寫入 settings 表的 reminder_settings，由 send-streak-reminder 寄出。
// 走 email，與推播無關——這一區不需要使用者開啟裝置推播。
export default function EmailReminderSection({ isOpen, toast }) {
  const { t, lang } = useLanguage();
  const { reminderSettings, loading, saving, loadReminderSettings, saveReminderSettings } = useReminderSettings();
  const [enabled, setEnabled] = useState(false);
  const [timezone, setTimezone] = useState('Asia/Taipei');
  const [hour, setHour] = useState(20);
  const [minute, setMinute] = useState(0);

  useEffect(() => {
    if (isOpen) loadReminderSettings();
  }, [isOpen, loadReminderSettings]);

  useEffect(() => {
    setEnabled(reminderSettings.enabled);
    setTimezone(reminderSettings.timezone);
    const [h, m] = (reminderSettings.time || '20:00').split(':').map(Number);
    setHour(h ?? 20);
    setMinute(Math.round((m ?? 0) / 5) * 5 % 60);
  }, [reminderSettings]);

  const handleSave = async () => {
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    try {
      await saveReminderSettings({ enabled, timezone, time: timeStr });
      toast.success(t('settings.notification.reminderSaved'));
    } catch (err) {
      toast.error(err.message || t('common.saveFailed'));
    }
  };

  const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const showDetectedHint = !loading && detectedTz && detectedTz !== timezone;
  const timezones = getCommonTimezones(lang);

  return (
    <>
      {loading ? <p className="reminder-modal__loading">{t('common.loadingDots')}</p> : (
        <div className="reminder-modal__content">
          <p className="reminder-modal__desc">
            {t('settings.notification.reminderDesc')}
          </p>
          <div className="reminder-modal__field">
            <label className="reminder-modal__toggle-label">
              <span>{t('settings.notification.enableEmail')}</span>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                className={`reminder-modal__toggle ${enabled ? 'is-on' : ''}`}
                onClick={() => setEnabled((v) => !v)}
              >
                <span className="reminder-modal__toggle-knob" />
              </button>
            </label>
          </div>
          <div className={`reminder-modal__settings ${!enabled ? 'is-disabled' : ''}`}>
            <div className="reminder-modal__field">
              <label className="reminder-modal__label" htmlFor="reminder-timezone">{t('settings.notification.timezone')}</label>
              <select
                id="reminder-timezone"
                className="reminder-modal__select"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                disabled={!enabled}
              >
                {timezones.map((tz) => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </select>
              {showDetectedHint && (
                <button
                  type="button"
                  className="reminder-modal__detect-btn"
                  onClick={() => setTimezone(detectedTz)}
                  disabled={!enabled}
                >
                  {t('settings.notification.detectedTimezone', { tz: detectedTz })}
                </button>
              )}
            </div>
            <div className="reminder-modal__field">
              <label className="reminder-modal__label">{t('settings.notification.reminderTime')}</label>
              <div className="reminder-modal__time-wheels">
                <WheelPicker items={HOURS} value={hour} onChange={setHour} disabled={!enabled} />
                <span className="reminder-modal__time-sep" aria-hidden="true">:</span>
                <WheelPicker items={MINUTES} value={minute} onChange={setMinute} disabled={!enabled} />
              </div>
            </div>
          </div>
          <div className="reminder-modal__actions">
            <button
              type="button"
              className="reminder-modal__save-btn"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? t('common.saving') : t('common.saveSettings')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
