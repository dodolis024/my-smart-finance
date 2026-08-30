import { createClient } from '@supabase/supabase-js';
import { getConfig } from './config.js';
import { clearStoredSession, resolveRefreshToken, writeStoredSession } from './auth.js';
import { ErrorCode, smfError } from './errors.js';

/**
 * 一律使用 anon key，永遠不使用 service_role。
 *
 * service_role 會繞過所有 RLS，一旦外流等於全站資料裸奔，而這套工具完全不需要它：
 * 所有資料表的 policy 都是 auth.uid() = user_id，帶著使用者自己的 session 就能讀寫自己的資料。
 */
export function createAnonClient() {
  const { url, anonKey } = getConfig();
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

let cachedClient = null;
let cachedUser = null;

/** 取得已帶入使用者 session 的 client；同一個行程內只會換一次 token */
export async function getAuthedClient() {
  if (cachedClient) return cachedClient;

  const client = createAnonClient();
  const { token, fromEnv } = resolveRefreshToken();

  const { data, error } = await client.auth.refreshSession({ refresh_token: token });
  if (error || !data?.session) {
    // 存下來的 token 失效就清掉，免得每次都拿同一個壞 token 重試
    if (!fromEnv) clearStoredSession();
    throw smfError(
      ErrorCode.NOT_AUTHENTICATED,
      '登入已失效',
      fromEnv
        ? 'SMF_REFRESH_TOKEN 已過期或無效，請重新取得'
        : '請重新執行 `finance login`'
    );
  }

  // env 模式不回寫檔案：那是使用者手動管理的憑證，不該被偷偷改掉
  if (!fromEnv) writeStoredSession(data.session);

  cachedClient = client;
  cachedUser = data.session.user;
  return client;
}

export async function getCurrentUser() {
  await getAuthedClient();
  return cachedUser;
}

/** 帳密登入，成功後存下 session */
export async function login(email, password) {
  const client = createAnonClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });

  if (error || !data?.session) {
    throw smfError(ErrorCode.NOT_AUTHENTICATED, `登入失敗：${error?.message || '帳號或密碼錯誤'}`);
  }

  writeStoredSession(data.session);
  return { email: data.user.email, userId: data.user.id };
}

/** 測試用：清掉行程內快取 */
export function resetClientCache() {
  cachedClient = null;
  cachedUser = null;
}
