import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * 靜默時區同步。
 *
 * 守的是「手動選的時區被自動蓋掉」：以前只要存的時區和裝置時區不同就寫回裝置時區，
 * 使用者人在台灣、刻意選別的時區，每次開 App 或一改完就被改回台灣。
 * 現在只有「裝置時區跟上次看到的不一樣」（真的換了地方）才同步。
 */

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const KEY = (userId) => `sf:tz:last-device:v1:${userId}`;

// 回傳同一個物件：hook 用 reminderSettings 當 effect 依賴
const h = vi.hoisted(() => ({
  auth: { session: {}, user: { id: 'user-a' } },
  reminder: {
    reminderSettings: { enabled: true, timezone: 'Asia/Taipei', time: '20:00' },
    loading: false, loadReminderSettings: vi.fn(), saveReminderSettings: vi.fn(),
  },
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => h.auth }));
vi.mock('@/hooks/useReminderSettings', () => ({ useReminderSettings: () => h.reminder }));

const { useTimezoneSync } = await import('@/hooks/useTimezoneSync');

function Probe() {
  useTimezoneSync();
  return null;
}

let container, root;
const setDeviceTz = (tz) => vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: tz });
// 每次換掉 reminderSettings 物件，模擬設定被存檔後 hook 拿到新值
const setSaved = (patch) => { h.reminder = { ...h.reminder, reminderSettings: { ...h.reminder.reminderSettings, ...patch } }; };
const render = async () => { await act(async () => root.render(createElement(Probe))); };
const save = () => h.reminder.saveReminderSettings;

beforeEach(() => {
  localStorage.clear();
  h.auth = { session: {}, user: { id: 'user-a' } };
  h.reminder = {
    reminderSettings: { enabled: true, timezone: 'Asia/Taipei', time: '20:00' },
    loading: false, loadReminderSettings: vi.fn(), saveReminderSettings: vi.fn().mockResolvedValue(undefined),
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('第一次（沒有紀錄）照舊同步', () => {
  it('存的時區和裝置不同就改成裝置時區，並記下裝置時區', async () => {
    setDeviceTz('Asia/Tokyo');
    await render();

    expect(save()).toHaveBeenCalledWith(expect.objectContaining({ timezone: 'Asia/Tokyo' }));
    expect(localStorage.getItem(KEY('user-a'))).toBe('Asia/Tokyo');
  });

  it('存的時區和裝置相同就不寫入，只記下裝置時區', async () => {
    setDeviceTz('Asia/Taipei');
    await render();

    expect(save()).not.toHaveBeenCalled();
    expect(localStorage.getItem(KEY('user-a'))).toBe('Asia/Taipei');
  });

  it('設定還在載入時不比對，載入完才比對', async () => {
    setDeviceTz('Asia/Tokyo');
    h.reminder.loading = true;
    await render();
    expect(save()).not.toHaveBeenCalled();

    h.reminder = { ...h.reminder, loading: false };
    await render();
    expect(save()).toHaveBeenCalledTimes(1);
  });
});

describe('手動選的時區不會被蓋掉', () => {
  it('開著 App 在設定頁改時區，不會被改回裝置時區', async () => {
    setDeviceTz('Asia/Taipei');
    await render();

    setSaved({ timezone: 'Europe/London' });
    await render();

    expect(save()).not.toHaveBeenCalled();
  });

  it('下次開 App，裝置時區沒變，就保留手動選的時區', async () => {
    setDeviceTz('Asia/Taipei');
    localStorage.setItem(KEY('user-a'), 'Asia/Taipei');
    setSaved({ timezone: 'Europe/London' });
    await render();

    expect(save()).not.toHaveBeenCalled();
  });
});

describe('裝置時區真的變了才同步', () => {
  it('上次在台灣、這次在東京：改成東京，並更新紀錄', async () => {
    setDeviceTz('Asia/Tokyo');
    localStorage.setItem(KEY('user-a'), 'Asia/Taipei');
    await render();

    expect(save()).toHaveBeenCalledWith(expect.objectContaining({ timezone: 'Asia/Tokyo', time: '20:00', enabled: true }));
    expect(localStorage.getItem(KEY('user-a'))).toBe('Asia/Tokyo');
  });

  it('提醒沒開就不同步，但記下裝置時區', async () => {
    setDeviceTz('Asia/Tokyo');
    localStorage.setItem(KEY('user-a'), 'Asia/Taipei');
    setSaved({ enabled: false });
    await render();

    expect(save()).not.toHaveBeenCalled();
    expect(localStorage.getItem(KEY('user-a'))).toBe('Asia/Tokyo');
  });

  it('寫入失敗時不記下裝置時區，下次開 App 會再試', async () => {
    setDeviceTz('Asia/Tokyo');
    localStorage.setItem(KEY('user-a'), 'Asia/Taipei');
    h.reminder.saveReminderSettings.mockRejectedValueOnce(new Error('offline'));
    await render();

    expect(save()).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(KEY('user-a'))).toBe('Asia/Taipei');
  });
});

describe('同一台裝置多個帳號', () => {
  it('紀錄依帳號分開：A 的紀錄不影響 B', async () => {
    setDeviceTz('Asia/Tokyo');
    localStorage.setItem(KEY('user-a'), 'Asia/Tokyo');
    h.auth = { session: {}, user: { id: 'user-b' } };
    await render();

    expect(save()).toHaveBeenCalledWith(expect.objectContaining({ timezone: 'Asia/Tokyo' }));
    expect(localStorage.getItem(KEY('user-b'))).toBe('Asia/Tokyo');
    expect(localStorage.getItem(KEY('user-a'))).toBe('Asia/Tokyo');
  });

  it('同一個分頁登出換帳號，新帳號也會比對一次', async () => {
    setDeviceTz('Asia/Taipei');
    await render();
    expect(save()).not.toHaveBeenCalled();

    h.auth = { session: {}, user: { id: 'user-b' } };
    setSaved({ timezone: 'Asia/Tokyo' });
    await render();

    expect(save()).toHaveBeenCalledWith(expect.objectContaining({ timezone: 'Asia/Taipei' }));
    expect(localStorage.getItem(KEY('user-b'))).toBe('Asia/Taipei');
  });
});
