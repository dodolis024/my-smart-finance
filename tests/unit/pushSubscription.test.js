import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * 登出／登入時的推播訂閱歸屬。
 *
 * 守的是「登出後還一直收到通知」這一類 bug：push_subscriptions 的 upsert
 * 衝突鍵是 (user_id, endpoint)，同一台裝置換帳號登入不會覆蓋舊那筆而是多一筆，
 * 漏清就會讓一台裝置同時收到兩個帳號的通知，且舊帳號登出多久都不會停。
 *
 * 另一半守的是修這個 bug 不能反過來收使用者的過路費：瀏覽器訂閱要留著，
 * 同一個人登入回來必須自動接回去，不能叫他再去設定裡開一次。
 */

const dbResult = { error: null };
const deleteCalls = [];
const upsertCalls = [];

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table) => {
      const call = { table, filters: {} };
      const query = {
        delete: () => query,
        eq: (col, val) => {
          call.filters[col] = val;
          // user_id 與 endpoint 兩個條件都下完才算送出
          if (Object.keys(call.filters).length === 2) {
            deleteCalls.push(call);
            return Promise.resolve(dbResult);
          }
          return query;
        },
        upsert: (row, options) => {
          upsertCalls.push({ table, row, options });
          return Promise.resolve(dbResult);
        },
      };
      return query;
    }),
  },
}));

const {
  clearPushSubscription,
  restorePushSubscription,
  rememberPushEnabled,
  forgetPushEnabled,
  getPushSubscribed,
  setPushSubscribed,
} = await import('@/lib/pushSubscription');

const USER = 'user-1';
const ENDPOINT = 'https://web.push.apple.com/AAA';
const unsubscribe = vi.fn().mockResolvedValue(true);

const subscription = {
  endpoint: ENDPOINT,
  unsubscribe,
  toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: 'key-p256dh', auth: 'key-auth' } }),
};

/** jsdom 沒有 serviceWorker/PushManager，全域 navigator 與 window.navigator 是不同物件，要各自裝上 */
function installServiceWorker({ subscription: sub }) {
  const registration = { pushManager: { getSubscription: vi.fn().mockResolvedValue(sub) } };
  Object.defineProperty(globalThis.navigator, 'serviceWorker', {
    value: { getRegistration: vi.fn().mockResolvedValue(registration) },
    configurable: true,
  });
  window.PushManager = function PushManager() {};
}

function removeServiceWorker() {
  delete globalThis.navigator.serviceWorker;
  delete window.PushManager;
}

beforeEach(() => {
  deleteCalls.length = 0;
  upsertCalls.length = 0;
  dbResult.error = null;
  unsubscribe.mockClear();
  localStorage.clear();
  setPushSubscribed(true);
});

afterEach(() => {
  removeServiceWorker();
  vi.restoreAllMocks();
});

describe('登出時清除推播訂閱', () => {
  it('刪掉這台裝置這個帳號的訂閱', async () => {
    installServiceWorker({ subscription });

    await clearPushSubscription(USER);

    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0].table).toBe('push_subscriptions');
    expect(deleteCalls[0].filters).toEqual({ user_id: USER, endpoint: ENDPOINT });
    expect(getPushSubscribed()).toBe(false);
  });

  it('不解除瀏覽器訂閱，本人登入回來才接得回去', async () => {
    installServiceWorker({ subscription });

    await clearPushSubscription(USER);

    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it('登出不清「開過通知」的記錄，否則下次登入就接不回來了', async () => {
    rememberPushEnabled(USER);
    installServiceWorker({ subscription });

    await clearPushSubscription(USER);

    expect(localStorage.getItem(`push-enabled:${USER}`)).toBe('1');
  });

  it('清理失敗不能擋下登出', async () => {
    Object.defineProperty(globalThis.navigator, 'serviceWorker', {
      value: { getRegistration: vi.fn().mockRejectedValue(new Error('boom')) },
      configurable: true,
    });
    window.PushManager = function PushManager() {};
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(clearPushSubscription(USER)).resolves.toBeUndefined();
  });

  it('這台裝置本來就沒訂閱時不發刪除', async () => {
    installServiceWorker({ subscription: null });

    await clearPushSubscription(USER);

    expect(deleteCalls).toHaveLength(0);
  });

  it('不支援推播的瀏覽器直接跳過', async () => {
    removeServiceWorker();

    await clearPushSubscription(USER);

    expect(deleteCalls).toHaveLength(0);
  });

  it('沒有登入者就不動作', async () => {
    installServiceWorker({ subscription });

    await clearPushSubscription(undefined);

    expect(deleteCalls).toHaveLength(0);
  });
});

describe('登入時還原推播訂閱', () => {
  it('開過通知的人登入回來，訂閱自動接回去，不用再開一次', async () => {
    rememberPushEnabled(USER);
    installServiceWorker({ subscription });

    await restorePushSubscription(USER);

    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].table).toBe('push_subscriptions');
    expect(upsertCalls[0].row).toEqual({
      user_id: USER,
      endpoint: ENDPOINT,
      p256dh: 'key-p256dh',
      auth: 'key-auth',
    });
    expect(getPushSubscribed()).toBe(true);
  });

  it('換另一個帳號登入不會被自動開通知', async () => {
    // 推播授權是整個網站共用的，光看授權狀態分不出是誰，
    // 少了這道判斷，同一台裝置上的下一個人會莫名開始收到通知
    rememberPushEnabled(USER);
    installServiceWorker({ subscription });

    await restorePushSubscription('user-2');

    expect(upsertCalls).toHaveLength(0);
  });

  it('沒開過通知的人登入不會被自動開', async () => {
    installServiceWorker({ subscription });

    await restorePushSubscription(USER);

    expect(upsertCalls).toHaveLength(0);
  });

  it('主動關掉通知後就不再自動接回來', async () => {
    rememberPushEnabled(USER);
    forgetPushEnabled(USER);
    installServiceWorker({ subscription });

    await restorePushSubscription(USER);

    expect(upsertCalls).toHaveLength(0);
  });

  it('瀏覽器端已經沒有訂閱時不寫入', async () => {
    rememberPushEnabled(USER);
    installServiceWorker({ subscription: null });

    await restorePushSubscription(USER);

    expect(upsertCalls).toHaveLength(0);
  });

  it('還原失敗不能影響登入', async () => {
    rememberPushEnabled(USER);
    dbResult.error = { message: 'network' };
    installServiceWorker({ subscription });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(restorePushSubscription(USER)).resolves.toBeUndefined();
  });
});
