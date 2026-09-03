import { getAuthedClient, getCurrentUser } from './client.js';
import { getTodayYmd } from './dates.js';
import { ErrorCode, fromSupabaseError, smfError } from './errors.js';
import { calcMemberTotals, calcSettlement } from './splitSettlement.js';
import { fetchRates } from './splitRates.js';

/**
 * ⚠️ 這個檔案是 src/hooks/useSplitExpenses.js 寫入邏輯的第二份實作。
 * 通知、簽到這些副作用少做一項，網頁與 CLI 的行為就會不一致。
 * 修改前請先看 tools/README.md 的「同步義務」一節。
 */

const EXPENSE_FIELDS = `
  id, group_id, paid_by, title, amount, currency, date, note, created_at,
  split_expense_shares ( id, member_id, share )
`;

// 沿用 listTransactions 的既有慣例：跑久的群組費用可能上百筆，全丟給 agent 會吃爆它的 context
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

/** 費用 id 的前綴比對至少要這麼長，太短的前綴命中誰全憑運氣 */
const MIN_ID_PREFIX = 4;

/**
 * 把 RPC 自己 raise 的例外轉成看得懂的中文。
 * 原始的 PostgREST 訊息（例如 SPLIT_SHARE_MEMBER_INVALID）對 agent 沒有可行動的資訊。
 */
function fromSplitRpcError(error, context) {
  const raw = String(error?.message || '');

  if (raw.includes('SPLIT_NO_ADD_PERMISSION') || raw.includes('SPLIT_NO_EDIT_PERMISSION')) {
    return smfError(
      ErrorCode.INVALID_INPUT,
      '你沒有這個分帳群組的操作權限',
      '請確認群組沒選錯；若是別人的群組，要先在網頁用邀請碼加入'
    );
  }
  if (raw.includes('SPLIT_SHARE_MEMBER_INVALID')) {
    return smfError(
      ErrorCode.MEMBER_NOT_FOUND,
      '付款人或分攤成員不屬於這個群組',
      '請用 finance split groups 查出正確的群組與成員名稱'
    );
  }
  if (raw.includes('SPLIT_SHARES_EMPTY')) {
    return smfError(
      ErrorCode.INVALID_INPUT,
      '這筆費用沒有任何分攤對象',
      '請用 --split 指定參與者，或省略 --split 讓全體成員均分'
    );
  }
  if (raw.includes('SPLIT_EXPENSE_NOT_FOUND')) {
    return smfError(
      ErrorCode.EXPENSE_NOT_FOUND,
      '找不到這筆分帳費用',
      '請用 finance split show <群組> 查出正確的費用 id'
    );
  }
  return fromSupabaseError(error, context);
}

/**
 * 送出分帳通知。
 *
 * 刻意不 await、失敗吞掉：通知寄不出去不該讓一筆已經寫好的帳看起來像失敗，
 * 這是比照前端 notifySplit 的既有行為。
 */
function notifySplit(client, payload) {
  client.functions.invoke('send-split-notification', { body: payload }).catch(() => {});
}

/** 通知需要「誰做的」，取的是登入者在這個群組裡連結的成員名稱（沒連結就給空字串，同前端） */
async function actorOf(group) {
  const user = await getCurrentUser();
  const member = (group.split_members || []).find((m) => m.user_id === user.id);
  return { actorName: member?.name ?? '', actorUserId: user.id };
}

/** 讀取群組的全部費用與還款紀錄（不截斷——結算要用全部資料算） */
export async function fetchLedger(groupId) {
  const client = await getAuthedClient();

  const { data: expenses, error } = await client
    .from('split_expenses')
    .select(EXPENSE_FIELDS)
    .eq('group_id', groupId)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw fromSupabaseError(error, '讀取分帳費用');

  const { data: settlements, error: settlementError } = await client
    .from('split_settlements')
    .select('*')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false });
  if (settlementError) throw fromSupabaseError(settlementError, '讀取還款紀錄');

  return { expenses: expenses || [], settlements: settlements || [] };
}

/**
 * 群組的完整報表：費用明細（依 limit 截斷）＋ 每人總支出 ＋ 結算建議。
 *
 * ⚠️ limit 只影響「印出幾筆明細」。memberTotals 與 settlement 一律用全部費用計算，
 * 拿截斷過的資料算錢會得到錯誤的欠款金額。
 */
export async function getGroupReport(group, { limit } = {}) {
  const [{ expenses, settlements }, rates] = await Promise.all([
    fetchLedger(group.id),
    fetchRates(),
  ]);

  const members = group.split_members || [];
  const shownLimit = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);

  return {
    group,
    expenses: expenses.slice(0, shownLimit),
    expenseCount: expenses.length,
    settlements,
    memberTotals: calcMemberTotals(members, expenses, rates, group.currency),
    settlement: calcSettlement(members, expenses, settlements, rates, group.currency),
    rates,
  };
}

/**
 * 用 id 取得一筆費用，接受截短的前綴。
 *
 * show 的人類表格印的是 8 碼，agent 很自然會直接把它餵回 rm / edit，
 * 少了前綴比對，「讀表格 → 操作」這條最順的路每次都會失敗。
 */
export async function getExpense(rawId) {
  const id = String(rawId || '').trim();
  if (!id) {
    throw smfError(
      ErrorCode.INVALID_INPUT,
      '必須指定費用 id',
      '請用 finance split show <群組> 查出費用 id'
    );
  }

  const client = await getAuthedClient();

  if (id.length === 36) {
    const { data, error } = await client
      .from('split_expenses')
      .select(EXPENSE_FIELDS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw fromSupabaseError(error, '讀取分帳費用');
    if (!data) {
      throw smfError(
        ErrorCode.EXPENSE_NOT_FOUND,
        `找不到 id 為 ${id} 的分帳費用`,
        '請用 finance split show <群組> 查出正確的費用 id（也可能是這筆費用不在你能看到的群組裡）'
      );
    }
    return data;
  }

  if (id.length < MIN_ID_PREFIX) {
    throw smfError(
      ErrorCode.INVALID_INPUT,
      `費用 id「${id}」太短，無法辨識`,
      `請至少給前 ${MIN_ID_PREFIX} 碼，或用 finance split show <群組> 查出完整 id`
    );
  }

  // RLS 已經把範圍限制在使用者看得到的群組，這裡只取 id 做前綴比對
  const { data, error } = await client.from('split_expenses').select('id, title, date, group_id');
  if (error) throw fromSupabaseError(error, '讀取分帳費用');

  const prefix = id.toLowerCase();
  const matches = (data || []).filter((row) => String(row.id).toLowerCase().startsWith(prefix));

  if (!matches.length) {
    throw smfError(
      ErrorCode.EXPENSE_NOT_FOUND,
      `找不到 id 以「${id}」開頭的分帳費用`,
      '請用 finance split show <群組> 查出正確的費用 id'
    );
  }
  if (matches.length > 1) {
    throw smfError(
      ErrorCode.INVALID_INPUT,
      `有 ${matches.length} 筆費用的 id 都以「${id}」開頭，無法判斷是哪一筆`,
      `請給更完整的 id：${matches.map((m) => `${m.id}（${m.date} ${m.title}）`).join('、')}`
    );
  }

  return getExpense(matches[0].id);
}

/**
 * 新增分帳費用。
 * 副作用的順序與前端一致：寫入 → 簽到（僅限今天）→ 通知。
 */
export async function addExpense({ group, title, amount, currency, date, note, paidBy, shares }) {
  const client = await getAuthedClient();

  const { data, error } = await client.rpc('add_split_expense', {
    p_group_id: group.id,
    p_title: title,
    p_amount: amount,
    p_currency: currency || 'TWD',
    p_date: date,
    p_note: note || null,
    p_paid_by: paidBy,
    p_shares: shares.map((s) => ({ member_id: s.member_id, share: s.share })),
  });
  if (error) throw fromSplitRpcError(error, '新增分帳費用');

  const { actorName, actorUserId } = await actorOf(group);
  const checkedIn = await maybeCheckIn(client, actorUserId, date);

  notifySplit(client, {
    event: 'expense_added',
    group_id: group.id,
    group_name: group.name,
    actor_name: actorName,
    actor_user_id: actorUserId,
    expense_title: title,
    expense_amount: amount,
    currency: currency || 'TWD',
  });

  return { expense: data, checkedIn };
}

/**
 * 簽到。
 *
 * 只有新增費用會簽到，編輯與刪除都不會——這是比照前端，不要「順手補齊」。
 * 失敗要吞掉：帳已經記進去了，簽到不成功不該讓它看起來像失敗。
 */
async function maybeCheckIn(client, userId, date) {
  if (!userId || date !== getTodayYmd()) return false;

  const { error } = await client
    .from('checkins')
    .upsert({ user_id: userId, date, source: 'onTimeTransaction' }, { onConflict: 'user_id,date' });

  return !error;
}

/** 修改分帳費用。比照前端：不簽到，只發 expense_updated 通知 */
export async function updateExpense({ group, expenseId, title, amount, currency, date, note, paidBy, shares }) {
  const client = await getAuthedClient();

  const { error } = await client.rpc('update_split_expense', {
    p_expense_id: expenseId,
    p_title: title,
    p_amount: amount,
    p_currency: currency || 'TWD',
    p_date: date,
    p_note: note || null,
    p_paid_by: paidBy,
    p_shares: shares.map((s) => ({ member_id: s.member_id, share: s.share })),
  });
  if (error) throw fromSplitRpcError(error, '修改分帳費用');

  const { actorName, actorUserId } = await actorOf(group);
  notifySplit(client, {
    event: 'expense_updated',
    group_id: group.id,
    group_name: group.name,
    actor_name: actorName,
    actor_user_id: actorUserId,
    expense_title: title,
  });

  const { data, error: readError } = await client
    .from('split_expenses')
    .select(EXPENSE_FIELDS)
    .eq('id', expenseId)
    .maybeSingle();
  if (readError) throw fromSupabaseError(readError, '讀取分帳費用');
  return data;
}

/**
 * 刪除分帳費用。
 * 分攤明細靠 ON DELETE CASCADE 清掉，不需要額外查詢（與前端一致）。
 */
export async function deleteExpense({ group, expense }) {
  const client = await getAuthedClient();

  const { error } = await client.from('split_expenses').delete().eq('id', expense.id);
  if (error) throw fromSupabaseError(error, '刪除分帳費用');

  const { actorName, actorUserId } = await actorOf(group);
  notifySplit(client, {
    event: 'expense_deleted',
    group_id: group.id,
    group_name: group.name,
    actor_name: actorName,
    actor_user_id: actorUserId,
    expense_title: expense.title ?? '',
  });

  return { deleted: expense };
}

/** 記一筆還款 */
export async function addSettlement({ group, fromMember, toMember, amount, currency }) {
  const client = await getAuthedClient();

  const { data, error } = await client
    .from('split_settlements')
    .insert({
      group_id: group.id,
      from_member: fromMember.id,
      to_member: toMember.id,
      amount,
      currency: currency || 'TWD',
    })
    .select('*')
    .single();
  if (error) throw fromSupabaseError(error, '新增還款紀錄');

  const { actorName, actorUserId } = await actorOf(group);
  notifySplit(client, {
    event: 'settlement_added',
    group_id: group.id,
    group_name: group.name,
    actor_name: actorName,
    actor_user_id: actorUserId,
    expense_amount: amount,
    currency: currency || 'TWD',
    from_name: fromMember.name,
    to_name: toMember.name,
  });

  return { settlement: data };
}
