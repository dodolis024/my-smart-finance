// 分帳相關 Postgres RPC 以穩定的 ASCII 錯誤碼（如 'SPLIT_INVALID_INVITE'）作為
// RAISE EXCEPTION 訊息字串，本模組把這些錯誤碼轉譯成使用者當前語言的文案。
// 對照表詳見 scripts/fix-split-error-codes.sql 檔頭與 locales/{zh,en}.js 的 errors 區塊。
const KNOWN_ERROR_CODES = new Set([
  'AUTH_REQUIRED',
  'SPLIT_NOT_LINKED_MEMBER',
  'SPLIT_RATE_UNAVAILABLE',
  'SPLIT_INVALID_INVITE',
  'SPLIT_GROUP_ARCHIVED',
  'SPLIT_ALREADY_MEMBER',
  'SPLIT_OWNER_ONLY',
  'SPLIT_MEMBER_NOT_FOUND',
  'SPLIT_MEMBER_LINKED',
  'SPLIT_EXPENSE_NOT_FOUND',
  'SPLIT_NO_EDIT_PERMISSION',
  'SPLIT_SHARES_EMPTY',
  'SPLIT_SHARE_MEMBER_INVALID',
  'SPLIT_NO_ADD_PERMISSION',
]);

/**
 * 把分帳 RPC 拋出的錯誤翻譯成使用者語言。
 * 未知錯誤碼回傳 null，交由呼叫端顯示通用 fallback 文案（絕不直接顯示原始 err.message）。
 *
 * @param {{ message?: string, details?: string }} err - supabase RPC 拋出的原始錯誤物件
 * @param {(key: string, params?: object) => string} t - LanguageContext 的 t()
 * @returns {string|null}
 */
export function resolveRpcError(err, t) {
  const code = err?.message;
  if (!KNOWN_ERROR_CODES.has(code)) return null;
  return t('errors.' + code, err?.details ? { currency: err.details } : undefined);
}
