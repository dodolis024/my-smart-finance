// 離線快取:把最近一次的儀表板資料與匯率存進 localStorage,
// 斷網時由 useDashboard 回退顯示(SW 層刻意不快取 Supabase 回應,見 public/sw.js)
// key 內含 schema 版本,資料結構改變時 bump 版本即可自然失效

const SNAPSHOT_PREFIX = 'sf:dash:v1';
const RATES_KEY = 'sf:rates:v1';
const CURRENCIES_KEY = 'sf:cur:v1';
const ACCOUNTS_PREFIX = 'sf:acct:v1';

function snapshotKey(userId, year, month) {
  return `${SNAPSHOT_PREFIX}:${userId}:${year}-${month}`;
}

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota 滿或隱私模式:離線快取屬 best-effort,靜默略過
  }
}

export function saveSnapshot(userId, year, month, data) {
  if (!userId) return;
  writeJson(snapshotKey(userId, year, month), { savedAt: Date.now(), data });
}

export function loadSnapshot(userId, year, month) {
  if (!userId) return null;
  const snap = readJson(snapshotKey(userId, year, month));
  return snap && snap.data ? snap : null;
}

export function saveRates(ratesMap) {
  writeJson(RATES_KEY, { savedAt: Date.now(), rates: ratesMap });
}

export function loadRates() {
  return readJson(RATES_KEY)?.rates || null;
}

export function saveCurrencies(list) {
  writeJson(CURRENCIES_KEY, list);
}

export function loadCurrencies() {
  const list = readJson(CURRENCIES_KEY);
  return Array.isArray(list) && list.length > 0 ? list : null;
}

// 帳戶清單獨立於月份快照儲存,離線記帳時用來解析 payment_method → account_id
export function saveAccounts(userId, accounts) {
  if (!userId || !Array.isArray(accounts)) return;
  writeJson(`${ACCOUNTS_PREFIX}:${userId}`, accounts);
}

export function loadAccounts(userId) {
  if (!userId) return [];
  const list = readJson(`${ACCOUNTS_PREFIX}:${userId}`);
  return Array.isArray(list) ? list : [];
}

// 判斷錯誤是否為「斷網」而非伺服器/資料錯誤:
// supabase-js 會把 fetch 失敗包成 message 含 Failed to fetch(Chrome)/Load failed(Safari)
export function isOfflineError(error) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  const message = error?.message || '';
  return /failed to fetch|load failed|networkerror/i.test(message);
}
