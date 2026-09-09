import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act, useContext } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * AuthContext 與推播訂閱的接線。
 *
 * pushSubscription 那支 lib 自己測得再全，接線接錯照樣整個不會動：
 * 登入沒呼叫還原 → 使用者得自己再開一次通知；
 * 清除排在 supabase.auth.signOut 之後 → session 已經沒了，刪 push_subscriptions
 * 過不了 RLS，那筆訂閱會留著繼續把通知推到這台裝置。
 * 這兩件事都不會讓任何既有測試變紅，所以在這裡單獨釘住。
 */

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const calls = [];
let session = null;

vi.mock('@/lib/supabase', () => ({
  createDefaultData: vi.fn(),
  supabase: {
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signOut: vi.fn(() => { calls.push('supabase.signOut'); return Promise.resolve({ error: null }); }),
    },
  },
}));

vi.mock('@/lib/resourceCache', () => ({ clearAllCaches: vi.fn() }));
vi.mock('@/lib/offlineCache', () => ({ clearUserCache: vi.fn() }));
vi.mock('@/lib/offlineQueue', () => ({ clearQueue: vi.fn() }));

vi.mock('@/lib/pushSubscription', () => ({
  clearPushSubscription: vi.fn((userId) => { calls.push(`clear:${userId}`); return Promise.resolve(); }),
  restorePushSubscription: vi.fn((userId) => { calls.push(`restore:${userId}`); return Promise.resolve(); }),
}));

const { AuthProvider, AuthContext } = await import('@/contexts/AuthContext');
const { clearPushSubscription, restorePushSubscription } = await import('@/lib/pushSubscription');

const USER = { id: 'user-1', email: 'a@example.com', app_metadata: {}, user_metadata: {} };

let container;
let root;
const auth = { current: null };

function Probe() {
  auth.current = useContext(AuthContext);
  return null;
}

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(AuthProvider, null, createElement(Probe)));
  });
}

beforeEach(() => {
  calls.length = 0;
  session = null;
  vi.clearAllMocks();
});

afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  root = null;
});

describe('AuthContext 的推播訂閱接線', () => {
  it('登入後把訂閱接回這個帳號', async () => {
    session = { user: USER };

    await mount();

    expect(restorePushSubscription).toHaveBeenCalledWith('user-1');
  });

  it('沒有登入者就不還原', async () => {
    await mount();

    expect(restorePushSubscription).not.toHaveBeenCalled();
  });

  it('登出時清掉這個帳號在這台裝置的訂閱', async () => {
    session = { user: USER };
    await mount();

    await act(async () => { await auth.current.signOut(); });

    expect(clearPushSubscription).toHaveBeenCalledWith('user-1');
  });

  it('清除必須排在 supabase.auth.signOut 之前，否則過不了 RLS', async () => {
    session = { user: USER };
    await mount();
    calls.length = 0;

    await act(async () => { await auth.current.signOut(); });

    expect(calls).toEqual(['clear:user-1', 'supabase.signOut']);
  });
});
