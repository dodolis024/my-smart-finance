import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { getConfig } from './config.js';
import { writeStoredSession } from './auth.js';
import { ErrorCode, smfError } from './errors.js';

/**
 * 瀏覽器 OAuth 登入（PKCE）。
 *
 * Google 帳號在 Supabase 裡沒有密碼，signInWithPassword 對它們永遠無效，
 * 所以走跟網頁一樣的 OAuth 流程：開瀏覽器讓使用者登入 → 導回本機 → 換取 session。
 *
 * 這裡會拿到獨立的一組 session，不會跟使用者的瀏覽器共用 refresh token
 * （共用會因為 Supabase 的 token 輪替而互相把對方踢登出）。
 */

const DEFAULT_PORT = 9876;
// CLI 可以慢慢等；MCP 那邊呼叫端通常有自己的逾時，所以會傳短一點的值進來
const DEFAULT_TIMEOUT_MS = 3 * 60 * 1000;

export function callbackPort() {
  return Number(process.env.SMF_OAUTH_PORT) || DEFAULT_PORT;
}

export function callbackUrl() {
  return `http://localhost:${callbackPort()}/callback`;
}

/**
 * PKCE 的 code verifier 需要存放處，而 Node 沒有 localStorage。
 * 用記憶體即可：整個流程在同一個行程內走完，不需要落地。
 */
function memoryStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };
}

function openBrowser(url) {
  // SSH 連線或無桌面環境時開不了瀏覽器，改成只印網址讓使用者自己貼到別台機器
  if (process.env.SMF_NO_BROWSER) return false;

  // Windows 走 cmd /c start 而不是 shell: true——後者會讓整條字串經過 shell 解析，
  // 是已知的命令注入形狀。start 的第一個空字串引數是視窗標題的佔位，少了它
  // 會把網址當成標題而開不了瀏覽器。
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    // detached + unref：瀏覽器不該綁著 CLI 的生命週期
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * 回呼頁的文字有一部分來自網址參數（error_description），直接內插就是反射型 XSS：
 * 登入進行中，任何網頁都能把使用者導到 /callback?error=<img src=x onerror=...>。
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function respondPage(res, { title, message, ok }) {
  res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, "PingFang TC", "Noto Sans TC", sans-serif; display: grid;
         place-items: center; height: 100vh; margin: 0; background: #f6f7f9; color: #1f2328; }
  .card { text-align: center; padding: 40px 48px; background: #fff; border-radius: 12px;
          box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  h1 { font-size: 18px; margin: 0 0 8px; }
  p { margin: 0; color: #656d76; font-size: 14px; }
  @media (prefers-color-scheme: dark) {
    body { background: #12141a; color: #e6e8eb; }
    .card { background: #1c1f26; box-shadow: none; }
    p { color: #9aa3ad; }
  }
</style></head>
<body><div class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></div></body></html>`);
}

/** 起一個只服務一次的本機 server，等 Supabase 把授權碼導回來 */
function waitForCallback(port, timeoutMs, expectedState) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end();
        return;
      }

      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error_description') || url.searchParams.get('error');

      // state 比對:回呼必須對應到本次自己發出的授權請求。少了這道,登入進行中的
      // 任何網頁都能往 /callback 丟東西打斷流程。PKCE 已經讓對方換不到 session,
      // 這裡擋的是干擾,不是竊取。
      if (url.searchParams.get('state') !== expectedState) {
        respondPage(res, { title: '登入失敗', message: '回呼來源不符,請重新登入。', ok: false });
        server.close();
        reject(smfError(
          ErrorCode.NOT_AUTHENTICATED,
          '回呼的 state 與本次登入請求不符',
          '可能是舊的登入分頁被重新開啟,或有其他網頁干擾。請重新執行 `finance login`'
        ));
        return;
      }

      if (error) {
        respondPage(res, { title: '登入失敗', message: error, ok: false });
        server.close();
        reject(smfError(ErrorCode.NOT_AUTHENTICATED, `授權失敗：${error}`));
        return;
      }
      if (!code) {
        respondPage(res, { title: '登入失敗', message: '沒有收到授權碼', ok: false });
        server.close();
        reject(smfError(ErrorCode.NOT_AUTHENTICATED, '回呼網址沒有帶授權碼'));
        return;
      }

      // 這頁 CLI 與 AI 助理兩種情境都會看到，別假設使用者面前有終端機
      respondPage(res, { title: '登入成功', message: '可以關閉這個分頁了。', ok: true });
      server.close();
      resolve(code);
    });

    server.on('error', (err) => {
      reject(
        err.code === 'EADDRINUSE'
          ? smfError(
              ErrorCode.NOT_AUTHENTICATED,
              `連接埠 ${port} 已被占用，無法接收登入回呼`,
              `請關閉占用該埠的程式，或用 SMF_OAUTH_PORT 指定其他埠（記得同步在 Supabase 的 Redirect URLs 加上新網址）`
            )
          : err
      );
    });

    server.listen(port, '127.0.0.1');

    setTimeout(() => {
      server.close();
      reject(
        smfError(
          ErrorCode.NOT_AUTHENTICATED,
          `登入逾時（${Math.round(timeoutMs / 1000)} 秒內未完成授權）`,
          '瀏覽器授權尚未完成。完成後再試一次即可，先前開啟的分頁可以直接關掉。'
        )
      );
    }, timeoutMs).unref();
  });
}

/**
 * @param {object} options
 * @param {string} options.provider  OAuth 提供者，預設 google
 * @param {(url: string, opened: boolean) => void} options.onPrompt 拿到授權網址時的回呼，供 CLI 提示使用者
 * @param {number} options.timeoutMs  等待使用者完成授權的上限
 */
export async function loginWithBrowser({ provider = 'google', onPrompt, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const { url: supabaseUrl, anonKey } = getConfig();
  // state 夾在 redirectTo 的 query 裡帶出去,Supabase 導回時會原樣保留。
  // Supabase 的 Redirect URLs 需含 http://localhost:9876/callback?*(萬用字元)
  // 才會放行帶 query 的回呼網址。
  const state = randomUUID();
  const redirectTo = `${callbackUrl()}?state=${state}`;

  const client = createClient(supabaseUrl, anonKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: memoryStorage(),
    },
  });

  const { data, error } = await client.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });

  if (error || !data?.url) {
    throw smfError(ErrorCode.NOT_AUTHENTICATED, `無法取得授權網址：${error?.message || '未知錯誤'}`);
  }

  // 先開始監聽再開瀏覽器，避免使用者手速太快時回呼撲空
  const codePromise = waitForCallback(callbackPort(), timeoutMs, state);
  const opened = openBrowser(data.url);
  if (onPrompt) onPrompt(data.url, opened);

  const code = await codePromise;

  const { data: sessionData, error: exchangeError } = await client.auth.exchangeCodeForSession(code);
  if (exchangeError || !sessionData?.session) {
    throw smfError(
      ErrorCode.NOT_AUTHENTICATED,
      `無法換取登入憑證：${exchangeError?.message || '未知錯誤'}`
    );
  }

  writeStoredSession(sessionData.session);
  return { email: sessionData.session.user.email, userId: sessionData.session.user.id };
}
