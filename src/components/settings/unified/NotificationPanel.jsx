import { useState, useEffect, useRef, useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import EmailReminderSection from './notification/EmailReminderSection';
import PushDeviceSection from './notification/PushDeviceSection';
import CreditCardNotifSection from './notification/CreditCardNotifSection';

// 這個檔案只負責三個區塊的摺疊開合與手機版的捲動定位。
// 每一區各自對應一個儲存位置，彼此不共用 state：
//   簽到提醒信 → settings.reminder_settings（email）
//   裝置推播   → push_subscriptions（推播的傳輸層）
//   信用卡通知 → settings.credit_card_notification_settings（推播）
export default function NotificationPanel({ isOpen, toast }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState({ reminder: false, push: false, creditCard: false });
  const reminderRef = useRef(null);
  const pushRef = useRef(null);
  const creditCardRef = useRef(null);
  const sectionRefs = useMemo(() => ({ reminder: reminderRef, push: pushRef, creditCard: creditCardRef }), []);
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
  }, [open, sectionRefs]);

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
        {open.reminder && <div className="notification-section__body"><EmailReminderSection isOpen={isOpen} toast={toast} /></div>}
      </div>
      <div className="category-group" ref={pushRef}>
        <SectionHeader id="push" label={t('settings.notification.devicePush')} />
        {open.push && <div className="notification-section__body"><PushDeviceSection /></div>}
      </div>
      <div className="category-group" ref={creditCardRef}>
        <SectionHeader id="creditCard" label={t('settings.notification.creditCardReminder')} />
        {open.creditCard && <div className="notification-section__body"><CreditCardNotifSection isOpen={isOpen} toast={toast} /></div>}
      </div>
    </div>
  );
}
