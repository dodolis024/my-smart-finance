import { useState, useEffect, useRef, useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import EmailReminderSection from './notification/EmailReminderSection';
import PushDeviceSection from './notification/PushDeviceSection';
import CreditCardNotifSection from './notification/CreditCardNotifSection';

// 這個檔案只負責三個區塊的摺疊開合與手機版的捲動定位。
// 標題列要顯示狀態（例如「每天 20:00」），所以三個 Section 一律 mount，
// 設定視窗一打開就載入資料，不再等展開才載。
// 每一區各自對應一個儲存位置，彼此不共用 state：
//   裝置推播   → push_subscriptions（推播的傳輸層）
//   簽到提醒信 → settings.reminder_settings（email）
//   信用卡通知 → settings.credit_card_notification_settings（推播）
export default function NotificationPanel({ isOpen, toast }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState({ push: false, reminder: false, creditCard: false });
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

  return (
    <div className="usm-panel">
      <h3 className="settings-manage__section-title">{t('settings.notification.sectionTitle')}</h3>
      <div className="settings-list">
        {/* 推播是傳輸層，要先開它下面的信用卡提醒才送得到，所以放第一個 */}
        <PushDeviceSection open={open.push} onToggle={() => toggle('push')} groupRef={pushRef} />
        <EmailReminderSection isOpen={isOpen} toast={toast} open={open.reminder} onToggle={() => toggle('reminder')} groupRef={reminderRef} />
        <CreditCardNotifSection isOpen={isOpen} toast={toast} open={open.creditCard} onToggle={() => toggle('creditCard')} groupRef={creditCardRef} />
      </div>
    </div>
  );
}
