import { useState, useEffect, useRef } from 'react';
import { WheelPicker, HOURS, MINUTES } from '../wheelPicker/WheelPicker';
import { getCommonTimezones } from '../data/commonTimezones';
import { useReminderSettings } from '@/hooks/useReminderSettings';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useCreditCardNotificationSettings } from '@/hooks/useCreditCardNotificationSettings';
import { useLanguage } from '@/contexts/LanguageContext';

function ReminderPanel({ isOpen, toast }) {
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

function PushSection() {
  const { t } = useLanguage();
  const { isSupported, permission, isSubscribed, loading, subscribe, unsubscribe } = usePushNotifications();

  const handleToggle = () => {
    if (isSubscribed) unsubscribe();
    else subscribe();
  };

  return (
    <div className="push-panel">
      <p className="push-panel__desc">
        {t('settings.notification.pushDesc')}
      </p>
      {!isSupported && (
        <p className="push-panel__warning">{t('settings.notification.browserNotSupported')}</p>
      )}
      {isSupported && permission === 'denied' && (
        <p className="push-panel__warning">{t('settings.notification.notificationBlocked')}</p>
      )}
      {isSupported && permission !== 'denied' && (
        <>
          <label className="push-panel__toggle-row">
            <span>{t('settings.notification.enablePush')}</span>
            <button
              type="button"
              role="switch"
              aria-checked={isSubscribed}
              className={`push-panel__toggle${isSubscribed ? ' is-on' : ''}`}
              onClick={handleToggle}
              disabled={loading}
            >
              <span className="push-panel__toggle-knob" />
            </button>
          </label>
          {isSubscribed && (
            <p className="push-panel__hint">{t('settings.notification.deviceSubscribed')}</p>
          )}
        </>
      )}
    </div>
  );
}

const DAYS_BEFORE_OPTIONS = [1, 2, 3, 5, 7];
const THRESHOLD_OPTIONS = [70, 80, 90];

function CreditCardNotifSection({ isOpen, toast }) {
  const { t } = useLanguage();
  const { settings, loading, saving, loadSettings, saveSettings } = useCreditCardNotificationSettings();
  const [paymentEnabled, setPaymentEnabled] = useState(false);
  const [daysBefore, setDaysBefore] = useState(3);
  const [usageEnabled, setUsageEnabled] = useState(false);
  const [threshold, setThreshold] = useState(80);

  useEffect(() => {
    if (isOpen) loadSettings();
  }, [isOpen, loadSettings]);

  useEffect(() => {
    if (!loading) {
      setPaymentEnabled(settings.payment_reminder_enabled ?? false);
      setDaysBefore(settings.payment_days_before ?? 3);
      setUsageEnabled(settings.usage_alert_enabled ?? false);
      setThreshold(settings.usage_warn_threshold ?? 80);
    }
  }, [loading, settings]);

  const handleSave = async () => {
    try {
      await saveSettings({
        payment_reminder_enabled: paymentEnabled,
        payment_days_before: daysBefore,
        usage_alert_enabled: usageEnabled,
        usage_warn_threshold: threshold,
      });
      toast.success(t('settings.notification.creditNotifSaved'));
    } catch {
      toast.error(t('common.saveFailed'));
    }
  };

  if (loading) return <p className="reminder-modal__loading">{t('common.loadingDots')}</p>;

  return (
    <div className="credit-notif-panel">
      <p className="credit-notif-panel__desc">
        {t('settings.notification.creditNotifDesc')}
      </p>

      <div className="credit-notif-panel__row">
        <label className="credit-notif-panel__toggle-row">
          <span className="credit-notif-panel__label">{t('settings.notification.paymentReminder')}</span>
          <button
            type="button"
            role="switch"
            aria-checked={paymentEnabled}
            className={`push-panel__toggle${paymentEnabled ? ' is-on' : ''}`}
            onClick={() => setPaymentEnabled((v) => !v)}
          >
            <span className="push-panel__toggle-knob" />
          </button>
        </label>
        {paymentEnabled && (
          <div className="credit-notif-panel__sub">
            <span className="credit-notif-panel__sub-label">{t('settings.notification.daysBefore')}</span>
            <div className="credit-notif-panel__chip-row">
              {DAYS_BEFORE_OPTIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`credit-notif-panel__chip${daysBefore === d ? ' is-selected' : ''}`}
                  onClick={() => setDaysBefore(d)}
                >
                  {d}{t('settings.notification.dayUnit')}
                </button>
              ))}
            </div>
            <p className="credit-notif-panel__hint">{t('settings.notification.daysBeforeHint')}</p>
          </div>
        )}
      </div>

      <div className="credit-notif-panel__row">
        <label className="credit-notif-panel__toggle-row">
          <span className="credit-notif-panel__label">{t('settings.notification.usageAlert')}</span>
          <button
            type="button"
            role="switch"
            aria-checked={usageEnabled}
            className={`push-panel__toggle${usageEnabled ? ' is-on' : ''}`}
            onClick={() => setUsageEnabled((v) => !v)}
          >
            <span className="push-panel__toggle-knob" />
          </button>
        </label>
        {usageEnabled && (
          <div className="credit-notif-panel__sub">
            <span className="credit-notif-panel__sub-label">{t('settings.notification.usageThreshold')}</span>
            <div className="credit-notif-panel__chip-row">
              {THRESHOLD_OPTIONS.map((val) => (
                <button
                  key={val}
                  type="button"
                  className={`credit-notif-panel__chip${threshold === val ? ' is-selected' : ''}`}
                  onClick={() => setThreshold(val)}
                >
                  {val}%
                </button>
              ))}
            </div>
            <p className="credit-notif-panel__hint">{t('settings.notification.usageOverHint')}</p>
          </div>
        )}
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
  );
}

export default function NotificationPanel({ isOpen, toast }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState({ reminder: false, push: false, creditCard: false });
  const reminderRef = useRef(null);
  const pushRef = useRef(null);
  const creditCardRef = useRef(null);
  const sectionRefs = { reminder: reminderRef, push: pushRef, creditCard: creditCardRef };
  const toggle = (k) => setOpen((s) => {
    const isMobile = window.matchMedia('(max-width: 600px)').matches;
    if (isMobile) {
      const allClosed = Object.fromEntries(Object.keys(s).map((key) => [key, false]));
      return { ...allClosed, [k]: !s[k] };
    }
    return { ...s, [k]: !s[k] };
  });
  useEffect(() => {
    if (!window.matchMedia('(max-width: 600px)').matches) return;
    const openKey = Object.keys(open).find((k) => open[k]);
    const el = openKey ? sectionRefs[openKey].current : null;
    const container = el?.closest('.usm__content');
    if (el && container) container.scrollTop = el.offsetTop - container.offsetTop;
  }, [open]);

  const SectionHeader = ({ id, label }) => (
    <div
      className="category-group__header"
      onClick={() => toggle(id)}
      style={{ cursor: 'pointer', userSelect: 'none' }}
    >
      <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" style={{ width: 14, height: 14, flexShrink: 0, transition: 'transform 0.2s', transform: open[id] ? 'rotate(90deg)' : 'rotate(0deg)' }}>
          <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z" clipRule="evenodd" />
        </svg>
        {label}
      </h4>
    </div>
  );

  return (
    <div className="usm-panel">
      <h3 className="settings-manage__section-title">{t('settings.notification.sectionTitle')}</h3>
      <div className="category-group" ref={reminderRef}>
        <SectionHeader id="reminder" label={t('settings.notification.checkinReminder')} />
        {open.reminder && <div className="notification-section__body"><ReminderPanel isOpen={isOpen} toast={toast} /></div>}
      </div>
      <div className="category-group" ref={pushRef}>
        <SectionHeader id="push" label={t('settings.notification.groupNotification')} />
        {open.push && <div className="notification-section__body"><PushSection /></div>}
      </div>
      <div className="category-group" ref={creditCardRef}>
        <SectionHeader id="creditCard" label={t('settings.notification.creditCardReminder')} />
        {open.creditCard && <div className="notification-section__body"><CreditCardNotifSection isOpen={isOpen} toast={toast} /></div>}
      </div>
    </div>
  );
}
