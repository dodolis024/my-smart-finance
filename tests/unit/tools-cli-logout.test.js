import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * CLI 登出。
 *
 * 只刪本機 session.json 的話，登出前被備份或同步走的 refresh token 仍然有效，
 * 所以這裡守的是「一定有嘗試撤銷伺服器端憑證」，以及撤銷失敗時仍要把本機檔案刪掉。
 */

const h = vi.hoisted(() => ({
  signOutCalls: 0,
  clearCalls: 0,
  clearResult: true,
  authedClientError: null,
  signOutError: null,
  reset() {
    this.signOutCalls = 0;
    this.clearCalls = 0;
    this.clearResult = true;
    this.authedClientError = null;
    this.signOutError = null;
  },
}));

vi.mock('../../tools/core/client.js', () => ({
  getAuthedClient: async () => {
    if (h.authedClientError) throw h.authedClientError;
    return {
      auth: {
        signOut: async () => {
          h.signOutCalls += 1;
          if (h.signOutError) throw h.signOutError;
          return { error: null };
        },
      },
    };
  },
  getCurrentUser: async () => ({ id: 'user-1', email: 'a@b.c' }),
  login: async () => ({ email: 'a@b.c' }),
}));

vi.mock('../../tools/core/auth.js', () => ({
  clearStoredSession: () => {
    h.clearCalls += 1;
    return h.clearResult;
  },
  sessionPath: () => '/tmp/session.json',
}));

vi.mock('../../tools/core/oauth.js', () => ({
  callbackUrl: () => 'http://localhost/callback',
  loginWithBrowser: async () => ({ email: 'a@b.c' }),
}));

const { logoutCommand } = await import('../../tools/cli/commands/auth.js');

let output;

beforeEach(() => {
  h.reset();
  output = [];
  vi.spyOn(console, 'log').mockImplementation((line) => output.push(String(line)));
});

describe('logoutCommand', () => {
  it('撤銷伺服器端憑證，並刪掉本機 session', async () => {
    await logoutCommand();

    expect(h.signOutCalls).toBe(1);
    expect(h.clearCalls).toBe(1);
    expect(output.join('\n')).toContain('已登出');
  });

  it('提醒撤銷是全帳號生效，其他裝置要重新登入', async () => {
    await logoutCommand();

    expect(output.join('\n')).toContain('其他裝置');
  });

  it('token 已失效導致取不到 client 時，仍刪掉本機 session', async () => {
    h.authedClientError = new Error('NOT_AUTHENTICATED');

    await logoutCommand();

    expect(h.signOutCalls).toBe(0);
    expect(h.clearCalls).toBe(1);
    expect(output.join('\n')).toContain('已登出');
  });

  it('撤銷過程出錯也不會擋住本機清除', async () => {
    h.signOutError = new Error('network down');

    await logoutCommand();

    expect(h.clearCalls).toBe(1);
  });

  it('本來就沒登入時說清楚，不假裝有登出', async () => {
    h.authedClientError = new Error('NOT_AUTHENTICATED');
    h.clearResult = false;

    await logoutCommand();

    expect(output.join('\n')).toContain('本來就沒有登入紀錄');
  });
});
