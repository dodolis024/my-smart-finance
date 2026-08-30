import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ErrorCode, smfError } from './errors.js';

const TOOLS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
export const PROJECT_ROOT = dirname(TOOLS_DIR);

/**
 * 極簡 .env parser。
 * 專案目前沒有 dotenv 依賴，為了讀兩個變數而多裝一個套件不划算。
 */
function parseEnvFile(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  const out = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * 內建的連線設定。
 *
 * 透過 npm 安裝的使用者手上沒有 .env.local，所以預設值必須跟著套件走。
 * 這樣做是安全的：anon（publishable）key 本來就是公開憑證，前端 bundle 裡就有一份，
 * 任何打開網站的人都拿得到；資料的安全性靠每張表的 RLS policy（auth.uid() = user_id），
 * 不是靠把這把 key 藏起來。真正不能外流的是 service_role key，這套工具完全不使用它。
 */
const DEFAULT_URL = 'https://rlahfuzsxfbocmkecqvg.supabase.co';
const DEFAULT_ANON_KEY = 'sb_publishable_wjxnEBkzCyZff_0ldN2_ag_jwyUaeF5';

let cached = null;

/**
 * 取得 Supabase 連線設定。
 * 優先讀 SMF_ 前綴的環境變數，其次回退到專案根目錄 .env.local 的 VITE_ 變數，
 * 讓本機開發者不用重複設定同一組值。
 */
export function getConfig() {
  if (cached) return cached;

  // 環境變數優先（開發時可指向另一個 Supabase 專案），其次是原始碼庫裡的 .env.local，
  // 最後才是內建預設——一般使用者走的就是這條，不需要任何設定
  const fileEnv = parseEnvFile(join(PROJECT_ROOT, '.env.local'));
  const url = process.env.SMF_SUPABASE_URL || fileEnv.VITE_SUPABASE_URL || DEFAULT_URL;
  const anonKey = process.env.SMF_SUPABASE_ANON_KEY || fileEnv.VITE_SUPABASE_ANON_KEY || DEFAULT_ANON_KEY;

  if (!url || !anonKey) {
    throw smfError(
      ErrorCode.CONFIG_MISSING,
      '找不到 Supabase 連線設定',
      '請設定環境變數 SMF_SUPABASE_URL 與 SMF_SUPABASE_ANON_KEY'
    );
  }

  cached = { url, anonKey };
  return cached;
}

/** 測試用：清掉快取，讓下一次 getConfig 重新讀取 */
export function resetConfigCache() {
  cached = null;
}
