import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * 通知設定面板。
 *
 * 這裡守的是「開了設定卻收不到通知」那一類問題：
 * 三個區塊各自寫到不同的儲存位置，但信用卡通知實際上要靠裝置推播才送得出去，
 * 使用者只開信用卡提醒是收不到的——所以未開推播時必須看到提示。
 */

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// 簽到提醒區的時間滾輪用 ResizeObserver，jsdom 沒有這個 API
window.ResizeObserver = window.ResizeObserver || class {
  observe() {} unobserve() {} disconnect() {}
};
global.ResizeObserver = window.ResizeObserver;

// 容器用 matchMedia 判斷手機版（手機一次只展開一區），jsdom 沒有這個 API
window.matchMedia = window.matchMedia || ((query) => ({
  matches: false, media: query, addEventListener() {}, removeEventListener() {},
}));

const h = vi.hoisted(() => ({
  push: { isSupported: true, permission: 'granted', isSubscribed: false, loading: false, subscribe: vi.fn(), unsubscribe: vi.fn() },
}));

vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k) => k, lang: 'zh' }) }));
vi.mock('@/hooks/usePushNotifications', () => ({ usePushNotifications: () => h.push }));
vi.mock('@/hooks/useReminderSettings', () => ({
  useReminderSettings: () => ({
    reminderSettings: { enabled: false, timezone: 'Asia/Taipei', time: '20:00' },
    loading: false, saving: false, loadReminderSettings: vi.fn(), saveReminderSettings: vi.fn(),
  }),
}));
vi.mock('@/hooks/useCreditCardNotificationSettings', () => ({
  useCreditCardNotificationSettings: () => ({
    settings: { payment_reminder_enabled: false, payment_days_before: 3, usage_alert_enabled: false, usage_warn_threshold: 80 },
    loading: false, saving: false, loadSettings: vi.fn(), saveSettings: vi.fn(),
  }),
}));

const NotificationPanel = (await import('@/components/settings/unified/NotificationPanel')).default;

let container, root;
beforeEach(() => {
  h.push.isSubscribed = false;
  h.push.isSupported = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const render = () => act(() => {
  root.render(createElement(NotificationPanel, { isOpen: true, toast: { success: vi.fn(), error: vi.fn() } }));
});
const headers = () => [...container.querySelectorAll('.category-group__header')];
const click = (el) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const text = () => container.textContent;

describe('NotificationPanel 容器', () => {
  it('三個區塊都在，且推播那區標成「裝置推播」而不是「群組通知」', () => {
    render();
    const labels = headers().map((h) => h.textContent);

    expect(labels).toEqual([
      'settings.notification.checkinReminder',
      'settings.notification.devicePush',
      'settings.notification.creditCardReminder',
    ]);
  });

  it('區塊預設收合，點開才載入內容', () => {
    render();
    expect(text()).not.toContain('settings.notification.enableEmail');

    click(headers()[0]);
    expect(text()).toContain('settings.notification.enableEmail');
  });

  it('三個區塊彼此獨立，展開一個不會影響另一個', () => {
    render();
    click(headers()[0]);
    click(headers()[2]);

    expect(text()).toContain('settings.notification.enableEmail');
    expect(text()).toContain('settings.notification.paymentReminder');
  });
});

describe('信用卡通知與裝置推播的連動', () => {
  it('未開啟裝置推播時，信用卡區要提示先去開推播', () => {
    h.push.isSubscribed = false;
    render();
    click(headers()[2]);

    expect(text()).toContain('settings.notification.pushRequiredHint');
  });

  it('已開啟裝置推播時不顯示提示', () => {
    h.push.isSubscribed = true;
    render();
    click(headers()[2]);

    expect(text()).not.toContain('settings.notification.pushRequiredHint');
  });

  it('瀏覽器不支援推播時不顯示提示（提示了也沒用）', () => {
    h.push.isSupported = false;
    h.push.isSubscribed = false;
    render();
    click(headers()[2]);

    expect(text()).not.toContain('settings.notification.pushRequiredHint');
  });
});
