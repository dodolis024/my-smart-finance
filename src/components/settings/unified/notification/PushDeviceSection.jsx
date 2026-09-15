import { useId } from 'react';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useLanguage } from '@/contexts/LanguageContext';
import DisclosureToggle from '../../DisclosureToggle';

// 裝置推播授權：對應 push_subscriptions 表，是「傳輸層」而不是某一項功能。
// send-split-notification、send-credit-card-reminder、send-credit-usage-alert
// 三個 Edge Function 都要先在這張表找得到這台裝置才送得出去，
// 所以這一區關掉，分帳與信用卡的推播會一起停。
export default function PushDeviceSection({ open, onToggle, groupRef }) {
  const { t } = useLanguage();
  const { isSupported, permission, isSubscribed, loading, subscribe, unsubscribe } = usePushNotifications();
  const bodyId = useId();
  const canToggle = isSupported && permission !== 'denied';

  const handleToggle = (e) => {
    e.stopPropagation();
    if (isSubscribed) unsubscribe();
    else subscribe();
  };

  let status;
  if (!isSupported) status = t('settings.notification.pushStatusUnsupported');
  else if (permission === 'denied') status = t('settings.notification.pushStatusBlocked');
  else if (isSubscribed) status = t('settings.notification.pushStatusOn');
  else status = t('settings.notification.statusOff');

  return (
    <div className="disclosure-group" ref={groupRef}>
      <div className="settings-list__row disclosure-row" onClick={onToggle}>
        <div className="settings-list__text">
          <span className="settings-list__label">{t('settings.notification.devicePush')}</span>
        </div>
        <div className="disclosure-right">
          <DisclosureToggle status={status} open={open} controls={bodyId} />
          {canToggle && (
            <button
              type="button"
              role="switch"
              aria-checked={isSubscribed}
              aria-label={t('settings.notification.enablePush')}
              className={`push-panel__toggle${isSubscribed ? ' is-on' : ''}`}
              onClick={handleToggle}
              disabled={loading}
            >
              <span className="push-panel__toggle-knob" />
            </button>
          )}
        </div>
      </div>
      {open && (
        <div id={bodyId}>
          <div className="settings-list__row settings-sub-row">
            <span className="settings-list__hint">{t('settings.notification.pushDesc')}</span>
          </div>
          {!isSupported && (
            <div className="settings-list__row settings-sub-row">
              <p className="push-panel__warning">{t('settings.notification.browserNotSupported')}</p>
            </div>
          )}
          {isSupported && permission === 'denied' && (
            <div className="settings-list__row settings-sub-row">
              <p className="push-panel__warning">{t('settings.notification.notificationBlocked')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
