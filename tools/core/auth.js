import { chmodSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { ErrorCode, smfError } from './errors.js';

/**
 * Session 存放。
 *
 * CLI 與 MCP server 共用同一個檔案：使用者只要 `finance login` 一次，掛在 Claude 裡的
 * MCP server 就能直接沿用，不必把 refresh token 手動貼進 MCP 設定檔（那是最容易外洩的環節）。
 * SMF_REFRESH_TOKEN 環境變數保留給 CI 或無法互動登入的環境。
 */
export function configDir() {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'my-smart-finance');
}

export function sessionPath() {
  return join(configDir(), 'session.json');
}

export function readStoredSession() {
  try {
    return JSON.parse(readFileSync(sessionPath(), 'utf8'));
  } catch {
    return null;
  }
}

export function writeStoredSession(session) {
  const path = sessionPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const payload = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at ?? null,
    email: session.user?.email ?? null,
    user_id: session.user?.id ?? null,
  };
  // 明確指定 0600：token 等同密碼，不能讓同機其他使用者讀到
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function clearStoredSession() {
  try {
    unlinkSync(sessionPath());
    return true;
  } catch {
    return false;
  }
}

/** 取得可用的 refresh token；環境變數優先，其次才是登入後存下的檔案 */
export function resolveRefreshToken() {
  const fromEnv = process.env.SMF_REFRESH_TOKEN;
  if (fromEnv) return { token: fromEnv, fromEnv: true };

  const stored = readStoredSession();
  if (stored?.refresh_token) return { token: stored.refresh_token, fromEnv: false };

  throw smfError(
    ErrorCode.NOT_AUTHENTICATED,
    '尚未登入',
    '請先執行 `finance login` 登入，或設定 SMF_REFRESH_TOKEN 環境變數'
  );
}
