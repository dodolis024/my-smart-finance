import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useLanguage } from '@/contexts/LanguageContext';

// 裝置推播授權：對應 push_subscriptions 表，是「傳輸層」而不是某一項功能。
// send-split-notification、send-credit-card-reminder、send-credit-usage-alert
// 三個 Edge Function 都要先在這張表找得到這台裝置才送得出去，
// 所以這一區關掉，分帳與信用卡的推播會一起停。
export default function PushDeviceSection() {
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
