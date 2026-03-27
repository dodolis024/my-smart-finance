import { useState, useEffect, useRef } from 'react';
import { WheelPicker, HOURS, MINUTES } from '../wheelPicker/WheelPicker';
import { COMMON_TIMEZONES } from '../data/commonTimezones';
import { useReminderSettings } from '@/hooks/useReminderSettings';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useCreditCardNotificationSettings } from '@/hooks/useCreditCardNotificationSettings';

function ReminderPanel({ isOpen, toast }) {
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
      toast.success('提醒設定已儲存！');
    } catch (err) {
      toast.error(err.message || '儲存失敗，請稍後再試。');
    }
  };

  const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const showDetectedHint = !loading && detectedTz && detectedTz !== timezone;

  return (
    <>
      {loading ? <p className="reminder-modal__loading">載入中...</p> : (
        <div className="reminder-modal__content">
          <p className="reminder-modal__desc">
            開啟後，系統會在你設定的時間以 email 提醒你記帳或簽到，避免連續記帳天數中斷。
          </p>
          <div className="reminder-modal__field">
            <label className="reminder-modal__toggle-label">
              <span>啟用 Email 提醒</span>
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
              <label className="reminder-modal__label" htmlFor="reminder-timezone">時區</label>
              <select
                id="reminder-timezone"
                className="reminder-modal__select"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                disabled={!enabled}
              >
                {COMMON_TIMEZONES.map((tz) => (
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
                  偵測到你目前的時區是 {detectedTz}，點此使用
                </button>
              )}
            </div>
            <div className="reminder-modal__field">
              <label className="reminder-modal__label">提醒時間</label>
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
              {saving ? '儲存中...' : '儲存設定'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function PushSection() {
  const { isSupported, permission, isSubscribed, loading, subscribe, unsubscribe } = usePushNotifications();

  const handleToggle = () => {
    if (isSubscribed) unsubscribe();
    else subscribe();
  };

  return (
    <div className="push-panel">
      <p className="push-panel__desc">
        開啟後，當分帳群組有成員新增或修改費用、新增或移除成員、記錄還款時，你會收到推播通知。
      </p>
      {!isSupported && (
        <p className="push-panel__warning">您的瀏覽器不支援推播通知。請改用 Chrome 或 Safari（iOS 需先將 App 加入主畫面）。</p>
      )}
      {isSupported && permission === 'denied' && (
        <p className="push-panel__warning">通知權限已被封鎖，請至瀏覽器設定開放此網站的通知權限後再試。</p>
      )}
      {isSupported && permission !== 'denied' && (
        <>
          <label className="push-panel__toggle-row">
            <span>啟用推播通知</span>
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
            <p className="push-panel__hint">此裝置已開啟通知，群組有異動時你將收到系統推播。</p>
          )}
        </>
      )}
    </div>
  );
}

const DAYS_BEFORE_OPTIONS = [1, 2, 3, 5, 7];
const THRESHOLD_OPTIONS = [70, 80, 90];

function CreditCardNotifSection({ isOpen, toast }) {
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
      toast.success('已儲存信用卡通知設定。');
    } catch {
      toast.error('儲存失敗，請稍後再試。');
    }
  };

  if (loading) return <p className="reminder-modal__loading">載入中...</p>;

  return (
    <div className="credit-notif-panel">
      <p className="credit-notif-panel__desc">
        通知套用至帳號中的所有信用卡帳戶，需先開啟推播通知才可收到提醒。
      </p>

      {/* 繳款日提醒 */}
      <div className="credit-notif-panel__row">
        <label className="credit-notif-panel__toggle-row">
          <span className="credit-notif-panel__label">繳款日提醒</span>
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
            <span className="credit-notif-panel__sub-label">提前幾天提醒</span>
            <div className="credit-notif-panel__chip-row">
              {DAYS_BEFORE_OPTIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`credit-notif-panel__chip${daysBefore === d ? ' is-selected' : ''}`}
                  onClick={() => setDaysBefore(d)}
                >
                  {d} 天
                </button>
              ))}
            </div>
            <p className="credit-notif-panel__hint">繳款日當天也會有提醒呦！</p>
          </div>
        )}
      </div>

      {/* 使用率警告 */}
      <div className="credit-notif-panel__row">
        <label className="credit-notif-panel__toggle-row">
          <span className="credit-notif-panel__label">額度使用率警告</span>
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
            <span className="credit-notif-panel__sub-label">偏高警戒閾值</span>
            <div className="credit-notif-panel__chip-row">
              {THRESHOLD_OPTIONS.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`credit-notif-panel__chip${threshold === t ? ' is-selected' : ''}`}
                  onClick={() => setThreshold(t)}
                >
                  {t}%
                </button>
              ))}
            </div>
            <p className="credit-notif-panel__hint">超過 100% 時亦會發送超額通知。</p>
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
          {saving ? '儲存中...' : '儲存設定'}
        </button>
      </div>
    </div>
  );
}

export default function NotificationPanel({ isOpen, toast }) {
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
      <h3 className="settings-manage__section-title">通知設定</h3>
      <div className="category-group" ref={reminderRef}>
        <SectionHeader id="reminder" label="簽到提醒" />
        {open.reminder && <div className="notification-section__body"><ReminderPanel isOpen={isOpen} toast={toast} /></div>}
      </div>
      <div className="category-group" ref={pushRef}>
        <SectionHeader id="push" label="群組通知" />
        {open.push && <div className="notification-section__body"><PushSection /></div>}
      </div>
      <div className="category-group" ref={creditCardRef}>
        <SectionHeader id="creditCard" label="信用卡提醒" />
        {open.creditCard && <div className="notification-section__body"><CreditCardNotifSection isOpen={isOpen} toast={toast} /></div>}
      </div>
    </div>
  );
}
