import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * CLI 登入的本機回呼頁。
 *
 * 登入進行中，任何網頁都能把使用者導到 http://localhost:9876/callback?error=...，
 * 而那段文字會被放進回應的 HTML。這裡真的把 server 起起來、打一個注入 payload 進去，
 * 驗證回應裡不會出現可執行的標籤。
 */

// 每個案例用不同埠：server 關閉與埠釋放之間有空窗，沿用同一個埠會撞 EADDRINUSE
let portSeq = 19876;

vi.mock('../../tools/core/config.js', () => ({
  getConfig: () => ({ url: 'https://example.supabase.co', anonKey: 'anon-key' }),
}));

vi.mock('../../tools/core/auth.js', () => ({ writeStoredSession: () => {} }));

const { loginWithBrowser } = await import('../../tools/core/oauth.js');

/**
 * 啟動登入流程並把一個回呼請求打進去，回傳該頁的 HTML 與本次的 state。
 *
 * 不 mock supabase-js：tools/ 有自己的 node_modules，vi.mock 的路徑對不上。
 * 改從流程實際產生的授權網址（onPrompt 拿得到）反解 redirect_to，取出本次 state，
 * 測的因此是真實行為。skipBrowserRedirect 讓 signInWithOAuth 只組網址、不連網。
 */
async function callbackResponse(query, { state = 'auto' } = {}) {
  const port = portSeq++;
  process.env.SMF_OAUTH_PORT = String(port);
  let authUrl = null;
  const pending = loginWithBrowser({
    timeoutMs: 5000,
    onPrompt: (url) => { authUrl = url; },
  }).catch((err) => err);
  // 等 server listen 完成、onPrompt 拿到授權網址
  await new Promise((r) => setTimeout(r, 150));

  const redirectTo = authUrl && new URL(authUrl).searchParams.get('redirect_to');
  const issued = redirectTo && new URL(redirectTo).searchParams.get('state');
  const actual = state === 'auto' ? issued : state;
  const suffix = actual == null ? '' : `&state=${encodeURIComponent(actual)}`;

  const res = await fetch(`http://localhost:${port}/callback?${query}${suffix}`);
  const html = await res.text();
  await pending;
  return { html, state: issued };
}

beforeEach(() => {
  process.env.SMF_NO_BROWSER = '1';
});

afterEach(() => {
  delete process.env.SMF_NO_BROWSER;
  delete process.env.SMF_OAUTH_PORT;
});

describe('回呼頁不會把網址參數變成 HTML', () => {
  it('標籤型 payload 被跳脫，不會出現可執行的 img 標籤', async () => {
    const { html } = await callbackResponse('error=' + encodeURIComponent('<img src=x onerror=alert(1)>'));

    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('script 標籤被跳脫', async () => {
    const { html } = await callbackResponse('error=' + encodeURIComponent('<script>alert(1)</script>'));

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('引號型 payload 無法跳出屬性', async () => {
    const { html } = await callbackResponse('error=' + encodeURIComponent('" onmouseover="alert(1)'));

    expect(html).not.toContain('onmouseover="alert(1)"');
    expect(html).toContain('&quot;');
  });

  it('正常錯誤訊息照樣讀得懂', async () => {
    const { html } = await callbackResponse('error_description=' + encodeURIComponent('存取遭拒'));

    expect(html).toContain('存取遭拒');
  });
});

describe('state 比對', () => {
  it('redirectTo 會帶上隨機 state', async () => {
    const { state } = await callbackResponse('error=' + encodeURIComponent('取消'));

    expect(state).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('state 不符的回呼被拒絕，不會被當成本次登入', async () => {
    const { html } = await callbackResponse('code=fake-code', { state: 'not-my-state' });

    expect(html).toContain('回呼來源不符');
  });

  it('完全沒帶 state 的回呼也被拒絕', async () => {
    const { html } = await callbackResponse('code=fake-code', { state: null });

    expect(html).toContain('回呼來源不符');
  });

  it('每次登入的 state 都不一樣', async () => {
    const first = await callbackResponse('error=x');
    const second = await callbackResponse('error=x');

    expect(second.state).not.toBe(first.state);
  });
});
