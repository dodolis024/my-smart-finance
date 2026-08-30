import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configDir } from './auth.js';

/**
 * 版本提醒。
 *
 * 用 npx 的人（MCP 設定）永遠拿到最新版，但用 npm install -g 裝的人不會自動更新，
 * 可能一直停在舊版。舊版最危險的情況是資料表結構變了卻還用舊邏輯寫入——不會報錯，
 * 只會默默寫出少欄位的資料，所以值得主動提醒。
 *
 * 三個原則：一天最多查一次、查詢失敗完全靜默、絕不阻塞主要工作太久。
 */

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2000;
const CACHE_FILE = 'update-check.json';

function cachePath() {
  return join(configDir(), CACHE_FILE);
}

function readCache() {
  try {
    return JSON.parse(readFileSync(cachePath(), 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    mkdirSync(configDir(), { recursive: true, mode: 0o700 });
    writeFileSync(cachePath(), JSON.stringify(data));
  } catch {
    // 寫不進去頂多是下次重新查，不值得打斷使用者
  }
}

/** 回傳 true 表示 a 比 b 新；只比對 x.y.z 的數字部分，預發行版一律當作較舊 */
export function isNewer(a, b) {
  const parse = (v) => String(v).split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const [a1, a2, a3] = parse(a);
  const [b1, b2, b3] = parse(b);
  if (a1 !== b1) return a1 > b1;
  if (a2 !== b2) return a2 > b2;
  return a3 > b3;
}

function currentVersion() {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  } catch {
    return null;
  }
}

async function fetchLatestVersion(name) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`https://registry.npmjs.org/${name}/latest`, {
      signal: controller.signal,
      headers: { accept: 'application/vnd.npm.install-v1+json' },
    });
    if (!res.ok) return null;
    return (await res.json())?.version || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 查有沒有新版；有的話回傳 { current, latest }，否則 null。
 * 距離上次查詢不到一天時直接用快取，不打網路。
 */
export async function checkForUpdate({ name = 'my-smart-finance-cli' } = {}) {
  const current = currentVersion();
  if (!current) return null;

  const cache = readCache();
  const fresh = cache && Date.now() - cache.checkedAt < CHECK_INTERVAL_MS;

  const latest = fresh ? cache.latest : await fetchLatestVersion(name);
  if (!latest) return null;

  if (!fresh) writeCache({ checkedAt: Date.now(), latest });

  return isNewer(latest, current) ? { current, latest, name } : null;
}

/** 提示印在 stderr，才不會污染 `finance list > file` 這類用法的輸出 */
export function printUpdateNotice({ current, latest, name }) {
  console.error(`\n有新版本可用：${current} → ${latest}`);
  console.error(`  執行 npm update -g ${name} 更新`);
}
