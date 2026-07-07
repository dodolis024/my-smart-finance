/**
 * 共用的模組級資源快取
 *
 * 各資料 hook（訂閱、提醒設定、分帳群組…）原本各自手刻一份「module-level cache +
 * userId 綁定」樣板。此模組把該機制集中一處，供 useCachedResource 使用：
 *   - 以 userId 綁定：切換帳號時舊資料自動失效（getCached 回 undefined 觸發重抓）
 *   - clearAllCaches：登出時一次清空，避免前一位使用者的資料續留記憶體
 *
 * 注意：value 可能是任何型別（含 null）。以「Map 是否有該 key 且 userId 相符」判定命中，
 * 用 undefined 代表「未命中」，故請勿把 undefined 當作有效快取值存入。
 */

const store = new Map(); // key -> { userId, value }

/**
 * 取得快取值；未命中或 userId 不符時回傳 undefined。
 */
export function getCached(key, userId) {
  const entry = store.get(key);
  if (entry && entry.userId === (userId ?? null)) return entry.value;
  return undefined;
}

/**
 * 寫入快取值，並記錄所屬 userId。
 */
export function setCached(key, userId, value) {
  store.set(key, { userId: userId ?? null, value });
}

/**
 * 清空所有快取（登出時呼叫）。
 */
export function clearAllCaches() {
  store.clear();
}
