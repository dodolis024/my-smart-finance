import { useState, useEffect, useRef, useId, useCallback } from 'react';
import { useCreditCardNotificationSettings } from '@/hooks/useCreditCardNotificationSettings';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useLanguage } from '@/contexts/LanguageContext';
import DisclosureToggle from '../../DisclosureToggle';

// 信用卡通知：設定寫入 settings 表的 credit_card_notification_settings，
// 但實際送達要靠 push_subscriptions（見 PushDeviceSection）——只開這裡收不到，
// 所以未訂閱時要提示使用者先去開裝置推播。
// 資料上是兩個獨立開關，沒有總開關可以對應，所以標題列只顯示狀態、不放開關。
// 即時儲存：每個控制項都是單次點擊，一律立即存；失敗才跳 toast 並還原成已存的值。
const DAYS_BEFORE_OPTIONS = [1, 2, 3, 5, 7];
const THRESHOLD_OPTIONS = [70, 80, 90];

export default function CreditCardNotifSection({ isOpen, toast, open, onToggle, groupRef }) {
  const { t } = useLanguage();
  const { settings, loading, loadSettings, saveSettings } = useCreditCardNotificationSettings();
  // 這裡的設定要靠 push_subscriptions 才送得出去；isSubscribed 由 usePushNotifications
  // 的跨實例 store 提供，使用者在「裝置推播」按下開關後這裡會即時跟著更新
  const { isSupported, isSubscribed } = usePushNotifications();
  const [paymentEnabled, setPaymentEnabled] = useState(false);
  const [daysBefore, setDaysBefore] = useState(3);
  const [usageEnabled, setUsageEnabled] = useState(false);
  const [threshold, setThreshold] = useState(80);
  const bodyId = useId();
  const paymentSwitchId = useId();
  const usageSwitchId = useId();
  const timerRef = useRef(null);
  const pendingRef = useRef(null);

  useEffect(() => {
    if (isOpen) loadSettings();
  }, [isOpen, loadSettings]);

  const resyncFromSaved = useCallback(() => {
    setPaymentEnabled(settings.payment_reminder_enabled ?? false);
    setDaysBefore(settings.payment_days_before ?? 3);
    setUsageEnabled(settings.usage_alert_enabled ?? false);
    setThreshold(settings.usage_warn_threshold ?? 80);
  }, [settings]);

  // 還有沒送出的變更時不覆寫，否則前一次存檔完成會把使用者剛點的值蓋回去
  useEffect(() => {
    if (!loading && !pendingRef.current) resyncFromSaved();
  }, [loading, resyncFromSaved]);

  const flush = async () => {
    clearTimeout(timerRef.current);
    const next = pendingRef.current;
    pendingRef.current = null;
    if (!next) return;
    try {
      await saveSettings(next);
    } catch {
      toast.error(t('common.saveFailed'));
      resyncFromSaved();
    }
  };
  // 計時器與卸載時的 cleanup 都透過 ref 呼叫，拿到的一定是最新一次 render 的 flush
  const flushRef = useRef(flush);
  useEffect(() => { flushRef.current = flush; });
  useEffect(() => () => { if (pendingRef.current) flushRef.current(); }, []); // 關視窗時把還沒存的存掉

  const persist = (patch, { immediate = false } = {}) => {
    const s = {
      payment_reminder_enabled: paymentEnabled,
      payment_days_before: daysBefore,
      usage_alert_enabled: usageEnabled,
      usage_warn_threshold: threshold,
      ...patch,
    };
    setPaymentEnabled(s.payment_reminder_enabled);
    setDaysBefore(s.payment_days_before);
    setUsageEnabled(s.usage_alert_enabled);
    setThreshold(s.usage_warn_threshold);
    pendingRef.current = s;
    clearTimeout(timerRef.current);
    if (immediate) flushRef.current();
    else timerRef.current = setTimeout(() => flushRef.current(), 600);
  };

  let status;
  if (loading) status = t('common.loadingDots');
  else if (paymentEnabled && usageEnabled) status = t('settings.notification.creditStatusBoth', { days: daysBefore, pct: threshold });
  else if (paymentEnabled) status = t('settings.notification.creditStatusPayment', { days: daysBefore });
  else if (usageEnabled) status = t('settings.notification.creditStatusUsage', { pct: threshold });
  else status = t('settings.notification.statusOff');

  return (
    <div className="disclosure-group" ref={groupRef}>
      <div className="settings-list__row disclosure-row" onClick={onToggle}>
        <div className="settings-list__text">
          <span className="settings-list__label">{t('settings.notification.creditCardReminder')}</span>
        </div>
        <div className="disclosure-right">
          <DisclosureToggle status={status} open={open} controls={bodyId} />
        </div>
      </div>
      {open && (
        <div id={bodyId}>
          {loading ? (
            <div className="settings-list__row settings-sub-row">
              <span className="settings-list__hint">{t('common.loadingDots')}</span>
            </div>
          ) : (
            <>
              <div className="settings-list__row settings-sub-row">
                <span className="settings-list__hint">{t('settings.notification.creditNotifDesc')}</span>
              </div>

              {isSupported && !isSubscribed && (
                <div className="settings-list__row settings-sub-row">
                  <p className="push-panel__warning">{t('settings.notification.pushRequiredHint')}</p>
                </div>
              )}

              <div className="settings-list__row settings-sub-row">
                <div className="settings-list__text">
                  <label className="settings-list__label" htmlFor={paymentSwitchId}>{t('settings.notification.paymentReminder')}</label>
                </div>
                <button
                  id={paymentSwitchId}
                  type="button"
                  role="switch"
                  aria-checked={paymentEnabled}
                  className={`push-panel__toggle${paymentEnabled ? ' is-on' : ''}`}
                  onClick={() => persist({ payment_reminder_enabled: !paymentEnabled }, { immediate: true })}
                >
                  <span className="push-panel__toggle-knob" />
                </button>
              </div>
              {paymentEnabled && (
                <div className="settings-list__row settings-sub-row">
                  <div className="settings-list__text">
                    <span className="settings-list__label">{t('settings.notification.daysBefore')}</span>
                    <span className="settings-list__hint">{t('settings.notification.daysBeforeHint')}</span>
                  </div>
                  <div className="credit-notif-panel__chip-row">
                    {DAYS_BEFORE_OPTIONS.map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={`credit-notif-panel__chip${daysBefore === d ? ' is-selected' : ''}`}
                        onClick={() => { if (d !== daysBefore) persist({ payment_days_before: d }, { immediate: true }); }}
                      >
                        {d}{t('settings.notification.dayUnit')}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="settings-list__row settings-sub-row">
                <div className="settings-list__text">
                  <label className="settings-list__label" htmlFor={usageSwitchId}>{t('settings.notification.usageAlert')}</label>
                </div>
                <button
                  id={usageSwitchId}
                  type="button"
                  role="switch"
                  aria-checked={usageEnabled}
                  className={`push-panel__toggle${usageEnabled ? ' is-on' : ''}`}
                  onClick={() => persist({ usage_alert_enabled: !usageEnabled }, { immediate: true })}
                >
                  <span className="push-panel__toggle-knob" />
                </button>
              </div>
              {usageEnabled && (
                <div className="settings-list__row settings-sub-row">
                  <div className="settings-list__text">
                    <span className="settings-list__label">{t('settings.notification.usageThreshold')}</span>
                    <span className="settings-list__hint">{t('settings.notification.usageOverHint')}</span>
                  </div>
                  <div className="credit-notif-panel__chip-row">
                    {THRESHOLD_OPTIONS.map((val) => (
                      <button
                        key={val}
                        type="button"
                        className={`credit-notif-panel__chip${threshold === val ? ' is-selected' : ''}`}
                        onClick={() => { if (val !== threshold) persist({ usage_warn_threshold: val }, { immediate: true }); }}
                      >
                        {val}%
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
