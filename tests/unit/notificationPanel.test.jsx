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

// 回傳同一個物件：元件用 reminderSettings 當 effect 依賴，每次 render 換新物件會一直重設畫面上的值
const h = vi.hoisted(() => ({
  push: { isSupported: true, permission: 'granted', isSubscribed: false, loading: false, subscribe: vi.fn(), unsubscribe: vi.fn() },
  reminder: {
    reminderSettings: { enabled: false, timezone: 'Asia/Taipei', time: '20:00' },
    loading: false, saving: false, loadReminderSettings: vi.fn(), saveReminderSettings: vi.fn(),
  },
}));

vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k) => k, lang: 'zh' }) }));
vi.mock('@/hooks/usePushNotifications', () => ({ usePushNotifications: () => h.push }));
vi.mock('@/hooks/useReminderSettings', () => ({ useReminderSettings: () => h.reminder }));
vi.mock('@/hooks/useCreditCardNotificationSettings', () => ({
  useCreditCardNotificationSettings: () => ({
    settings: { payment_reminder_enabled: false, payment_days_before: 3, usage_alert_enabled: false, usage_warn_threshold: 80 },
    loading: false, saving: false, loadSettings: vi.fn(), saveSettings: vi.fn(),
  }),
}));

const NotificationPanel = (await import('@/components/settings/unified/NotificationPanel')).default;

let container, root, toast;
beforeEach(() => {
  toast = { success: vi.fn(), error: vi.fn() };
  h.push.isSubscribed = false;
  h.push.isSupported = true;
  h.reminder.reminderSettings = { enabled: false, timezone: 'Asia/Taipei', time: '20:00' };
  h.reminder.saveReminderSettings.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });

const render = () => act(() => {
  root.render(createElement(NotificationPanel, { isOpen: true, toast }));
});
// 區塊順序：裝置推播、簽到提醒、信用卡提醒
const headers = () => [...container.querySelectorAll('.disclosure-row')];
const click = (el) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const text = () => container.textContent;

describe('NotificationPanel 容器', () => {
  it('三個區塊都在，且推播那區標成「裝置推播」而不是「群組通知」', () => {
    render();
    const labels = headers().map((h) => h.querySelector('.settings-list__label').textContent);

    expect(labels).toEqual([
      'settings.notification.devicePush',
      'settings.notification.checkinReminder',
      'settings.notification.creditCardReminder',
    ]);
  });

  // 簽到提醒的總開關在標題列上，收合時也在；改用展開後才出現的「提醒時間」判斷
  it('區塊預設收合，點開才載入內容', () => {
    render();
    expect(text()).not.toContain('settings.notification.reminderTime');

    click(headers()[1]);
    expect(text()).toContain('settings.notification.reminderTime');
  });

  it('三個區塊彼此獨立，展開一個不會影響另一個', () => {
    render();
    click(headers()[1]);
    click(headers()[2]);

    expect(text()).toContain('settings.notification.reminderTime');
    expect(text()).toContain('settings.notification.paymentReminder');
  });

  it('收合時標題列就顯示狀態', () => {
    render();
    expect(headers()[1].textContent).toContain('settings.notification.statusOff');
  });
});

describe('標題列開關與即時儲存', () => {
  it('簽到提醒的開關收合時就能切換，立即存檔，而且不會把區塊展開', () => {
    render();
    const header = headers()[1];
    const toggle = header.querySelector('[role="switch"]');
    click(toggle);

    expect(h.reminder.saveReminderSettings).toHaveBeenCalledTimes(1);
    expect(h.reminder.saveReminderSettings).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(header.querySelector('[aria-expanded]').getAttribute('aria-expanded')).toBe('false');
    expect(text()).not.toContain('settings.notification.reminderTime');
  });

  it('展開後調整時區，停止調整 600ms 後才存', () => {
    h.reminder.reminderSettings = { enabled: true, timezone: 'Asia/Taipei', time: '20:00' };
    vi.useFakeTimers();
    render();
    click(headers()[1]);

    const select = container.querySelector('select');
    const next = [...select.options].find((o) => o.value !== 'Asia/Taipei').value;
    act(() => {
      select.value = next;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    act(() => vi.advanceTimersByTime(599));
    expect(h.reminder.saveReminderSettings).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(h.reminder.saveReminderSettings).toHaveBeenCalledTimes(1);
    expect(h.reminder.saveReminderSettings).toHaveBeenCalledWith(expect.objectContaining({ timezone: next }));
  });

  it('信用卡區沒有總開關，標題列不放開關', () => {
    render();
    expect(headers()[2].querySelector('[role="switch"]')).toBeNull();
  });

  it('瀏覽器不支援推播時，標題列不放開關，狀態寫出原因', () => {
    h.push.isSupported = false;
    render();

    expect(headers()[0].querySelector('[role="switch"]')).toBeNull();
    expect(headers()[0].textContent).toContain('settings.notification.pushStatusUnsupported');
  });

  it('存檔失敗時跳提示，畫面還原成最後一次存下的值', async () => {
    h.reminder.saveReminderSettings.mockRejectedValueOnce(new Error(''));
    render();
    const toggle = headers()[1].querySelector('[role="switch"]');
    await act(async () => toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(toast.error).toHaveBeenCalledWith('common.saveFailed');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('調整後 600ms 內就關掉視窗，還沒存的值照樣存出去', () => {
    h.reminder.reminderSettings = { enabled: true, timezone: 'Asia/Taipei', time: '20:00' };
    vi.useFakeTimers();
    render();
    click(headers()[1]);

    const select = container.querySelector('select');
    const next = [...select.options].find((o) => o.value !== 'Asia/Taipei').value;
    act(() => {
      select.value = next;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    act(() => vi.advanceTimersByTime(300));
    expect(h.reminder.saveReminderSettings).not.toHaveBeenCalled();

    act(() => root.render(null));
    expect(h.reminder.saveReminderSettings).toHaveBeenCalledTimes(1);
    expect(h.reminder.saveReminderSettings).toHaveBeenCalledWith(expect.objectContaining({ timezone: next }));
  });

  it('時間滾輪回報的值沒變就不存（程式捲動定位也會觸發回報）', () => {
    h.reminder.reminderSettings = { enabled: true, timezone: 'Asia/Taipei', time: '20:00' };
    vi.useFakeTimers();
    render();
    click(headers()[1]);

    // 滾輪用 scrollTop 反推選中哪一格；jsdom 不排版，這裡直接指定捲動位置
    // 每格 40px、清單重複 7 份，中間那份從第 72 格開始，20 點就是第 92 格
    const hourWheel = container.querySelector('.wheel-picker__scroll');
    let scrollTop = 0;
    Object.defineProperty(hourWheel, 'scrollTop', { configurable: true, get: () => scrollTop, set: (v) => { scrollTop = v; } });
    const scrollToHour = (hour) => act(() => {
      scrollTop = (72 + hour) * 40;
      hourWheel.dispatchEvent(new Event('scroll'));
    });

    scrollToHour(20);
    act(() => vi.advanceTimersByTime(1000));
    expect(h.reminder.saveReminderSettings).not.toHaveBeenCalled();

    scrollToHour(21);
    act(() => vi.advanceTimersByTime(600));
    expect(h.reminder.saveReminderSettings).toHaveBeenCalledTimes(1);
    expect(h.reminder.saveReminderSettings).toHaveBeenCalledWith(expect.objectContaining({ time: '21:00' }));
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
