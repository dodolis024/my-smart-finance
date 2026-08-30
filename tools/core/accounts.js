import { getAuthedClient } from './client.js';
import { ErrorCode, fromSupabaseError, smfError } from './errors.js';

export async function listAccounts() {
  const client = await getAuthedClient();
  const { data, error } = await client
    .from('accounts')
    .select('id, name, type, credit_limit, billing_day, payment_due_day')
    .order('name');

  if (error) throw fromSupabaseError(error, '讀取帳戶');
  return data || [];
}

/**
 * 用名稱找帳戶。
 *
 * 前端在帳戶名稱對不上時是存 account_id: null（保留 payment_method 字串），這裡刻意更嚴格：
 * 直接報錯並附上可用清單。因為 agent 會自信地猜名稱（「信用卡」vs「信用卡A」），
 * 靜默存成 null 會讓那筆交易失去帳戶關聯，而使用者要很久以後看報表才會發現。
 */
export async function resolveAccount(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    throw smfError(ErrorCode.INVALID_INPUT, '必須指定付款方式（帳戶）');
  }

  const accounts = await listAccounts();
  const match = accounts.find((a) => a.name === trimmed);
  if (match) return match;

  throw smfError(
    ErrorCode.ACCOUNT_NOT_FOUND,
    `找不到名稱為「${trimmed}」的帳戶`,
    `可用的帳戶：${accounts.map((a) => a.name).join('、') || '（尚未建立任何帳戶，請先到網頁設定新增）'}`
  );
}
