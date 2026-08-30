/**
 * 結構化錯誤。
 *
 * agent 跟人類不一樣：它看到錯誤會立刻重試，所以錯誤訊息必須帶著「怎麼改才對」的
 * 線索（hint），否則它只會用另一個猜測再試一次。hint 會原封不動回給 MCP 呼叫端。
 */

export const ErrorCode = {
  NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
  CONFIG_MISSING: 'CONFIG_MISSING',
  INVALID_INPUT: 'INVALID_INPUT',
  RATE_UNAVAILABLE: 'RATE_UNAVAILABLE',
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  CATEGORY_NOT_FOUND: 'CATEGORY_NOT_FOUND',
  NOT_FOUND: 'NOT_FOUND',
  DB_ERROR: 'DB_ERROR',
};

export class SmfError extends Error {
  constructor(code, message, hint = null) {
    super(message);
    this.name = 'SmfError';
    this.code = code;
    this.hint = hint;
  }

  toJSON() {
    return { error: this.code, message: this.message, ...(this.hint ? { hint: this.hint } : {}) };
  }
}

export function smfError(code, message, hint = null) {
  return new SmfError(code, message, hint);
}

/** 把 Supabase 回傳的 error 物件轉成 SmfError，避免原始 PostgREST 訊息直接外流給 agent */
export function fromSupabaseError(error, context) {
  return smfError(ErrorCode.DB_ERROR, `${context}失敗：${error.message || '未知的資料庫錯誤'}`);
}
