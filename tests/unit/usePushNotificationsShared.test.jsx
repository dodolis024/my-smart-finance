import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * 推播訂閱狀態的跨元件同步。
 *
 * 設定面板的「裝置推播」與「信用卡通知」兩區各自呼叫這個 hook。
 * 若每個實例各持一份 state，使用者按下推播開關後，信用卡區的
 *「請先開啟推播」提示不會消失，要重開設定才對得上。
 */

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  subscription: null,
  upsertCalls: [],
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      upsert: async (row) => { h.upsertCalls.push(row); return { error: null }; },
      delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
    }),
  },
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));

const fakeSub = {
  endpoint: 'https://push.example/abc',
  toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } }),
  unsubscribe: async () => true,
};

beforeEach(() => {
  h.subscription = null;
  h.upsertCalls = [];
  global.Notification = { permission: 'granted' };
  window.Notification = global.Notification;
  const registration = {
    pushManager: {
      getSubscription: async () => h.subscription,
      subscribe: async () => { h.subscription = fakeSub; return fakeSub; },
    },
  };
  global.navigator.serviceWorker = { ready: Promise.resolve(registration), register: async () => registration };
  window.PushManager = function PushManager() {};
  global.PushManager = window.PushManager;
});

const { usePushNotifications } = await import('@/hooks/usePushNotifications');

/** 同時掛兩個獨立元件，各自呼叫 hook——就是設定面板的實際情形 */
function TwoConsumers() {
  const a = usePushNotifications();
  const b = usePushNotifications();
  return createElement('div', null,
    createElement('span', { id: 'a' }, String(a.isSubscribed)),
    createElement('span', { id: 'b' }, String(b.isSubscribed)),
    createElement('button', { id: 'sub', onClick: a.subscribe }, 'go'),
    createElement('button', { id: 'unsub', onClick: a.unsubscribe }, 'stop'),
  );
}

let container, root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

const val = (id) => container.querySelector(`#${id}`).textContent;
const click = async (id) => { await act(async () => { container.querySelector(`#${id}`).dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };

describe('usePushNotifications 的訂閱狀態', () => {
  it('一個元件訂閱後，另一個元件要立刻看到已訂閱', async () => {
    await act(async () => { root.render(createElement(TwoConsumers)); });
    expect([val('a'), val('b')]).toEqual(['false', 'false']);

    await click('sub');

    expect([val('a'), val('b')]).toEqual(['true', 'true']);
    expect(h.upsertCalls[0]).toMatchObject({ user_id: 'user-1', endpoint: 'https://push.example/abc' });
  });

  it('取消訂閱也要同步到另一個元件', async () => {
    await act(async () => { root.render(createElement(TwoConsumers)); });
    await click('sub');
    expect(val('b')).toBe('true');

    await click('unsub');

    expect([val('a'), val('b')]).toEqual(['false', 'false']);
  });
});
