import { useState, useEffect } from 'react';
import { useCreditCardNotificationSettings } from '@/hooks/useCreditCardNotificationSettings';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useLanguage } from '@/contexts/LanguageContext';

// 信用卡通知：設定寫入 settings 表的 credit_card_notification_settings，
// 但實際送達要靠 push_subscriptions（見 PushDeviceSection）——只開這裡收不到，
// 所以未訂閱時要提示使用者先去開裝置推播。
const DAYS_BEFORE_OPTIONS = [1, 2, 3, 5, 7];
const THRESHOLD_OPTIONS = [70, 80, 90];

export default function CreditCardNotifSection({ isOpen, toast }) {
  const { t } = useLanguage();
  const { settings, loading, saving, loadSettings, saveSettings } = useCreditCardNotificationSettings();
  // 這裡的設定要靠 push_subscriptions 才送得出去；isSubscribed 由 usePushNotifications
  // 的跨實例 store 提供，使用者在「裝置推播」按下開關後這裡會即時跟著更新
  const { isSupported, isSubscribed } = usePushNotifications();
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

      {isSupported && !isSubscribed && (
        <p className="push-panel__warning">{t('settings.notification.pushRequiredHint')}</p>
      )}

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
