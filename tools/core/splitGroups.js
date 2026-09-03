import { getAuthedClient, getCurrentUser } from './client.js';
import { ErrorCode, fromSupabaseError, smfError } from './errors.js';

/**
 * 分帳群組與成員的名稱解析。
 *
 * 比照 core/accounts.js 的 resolveAccount：一律精確比對，對不上就報錯並在 hint 列出
 * 所有可用值。agent 會自信地猜名稱，靜默選錯成員等於把錢算到別人頭上，
 * 而使用者要很久以後對帳才會發現。
 */

const GROUP_FIELDS = `
  id, name, currency, default_expense_currency, archived_at, created_at,
  split_members ( id, name, user_id, created_at )
`;

/** 代表「登入者自己」的寫法。使用者對 agent 說的是「我跟小明吃飯」，agent 會原樣傳進來 */
const SELF_ALIASES = ['me', '我', '自己'];

/**
 * 讀取我的所有分帳群組（含成員名單）。
 *
 * ⚠️ 成員一律依 created_at 由舊到新排序，因為均分的零頭是給「成員順序中的第一位」。
 * 排序改掉，同一筆帳在網頁與 CLI 就會有一分錢的差異，而且只在除不盡時出現。
 * 群組本身則是未封存的排在前面，各自再依建立時間由新到舊（與網頁列表同序）。
 */
export async function listGroups() {
  const client = await getAuthedClient();
  const { data, error } = await client
    .from('split_groups')
    .select(GROUP_FIELDS)
    .order('created_at', { ascending: false });

  if (error) throw fromSupabaseError(error, '讀取分帳群組');

  const groups = (data || []).map((group) => ({
    ...group,
    split_members: [...(group.split_members || [])].sort(
      (a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''))
    ),
  }));

  return groups.sort((a, b) => Number(!!a.archived_at) - Number(!!b.archived_at));
}

function groupNameList(groups) {
  if (!groups.length) return '（你目前沒有任何分帳群組）';
  return groups
    .map((g) => (g.archived_at ? `${g.name}（已封存）` : g.name))
    .join('、');
}

/**
 * 名稱 → 群組。
 *
 * 沒給名稱時，只有一個未封存群組就直接採用（單群組使用者零負擔）；
 * 有多個就報錯並列出候選——「錯誤訊息即導航」，agent 拿著清單回頭問使用者。
 */
export async function resolveGroup(name) {
  const groups = await listGroups();
  const trimmed = String(name || '').trim();

  if (trimmed) {
    const matches = groups.filter((g) => g.name === trimmed);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw smfError(
        ErrorCode.INVALID_INPUT,
        `有多個群組都叫「${trimmed}」，無法判斷是哪一個`,
        '請到網頁把其中一個群組改名以便區分'
      );
    }
    throw smfError(
      ErrorCode.GROUP_NOT_FOUND,
      `找不到名稱為「${trimmed}」的分帳群組`,
      `你的群組：${groupNameList(groups)}`
    );
  }

  if (!groups.length) {
    throw smfError(
      ErrorCode.GROUP_NOT_FOUND,
      '你目前沒有任何分帳群組',
      '請先到網頁建立分帳群組（CLI 第一版不支援建立群組與用邀請碼加入）'
    );
  }

  const active = groups.filter((g) => !g.archived_at);
  if (active.length === 1) return active[0];

  if (!active.length) {
    throw smfError(
      ErrorCode.INVALID_INPUT,
      '你的分帳群組都已封存，請用 --group 指定要操作哪一個',
      `你的群組：${groupNameList(groups)}`
    );
  }

  throw smfError(
    ErrorCode.INVALID_INPUT,
    '你有多個分帳群組，請用 --group 指定',
    `你的群組：${groupNameList(groups)}`
  );
}

/** 用 id 取得群組（edit / rm 只拿得到費用 id，得反查它屬於哪個群組） */
export async function getGroupById(groupId) {
  const groups = await listGroups();
  const group = groups.find((g) => g.id === groupId);
  if (group) return group;

  throw smfError(
    ErrorCode.GROUP_NOT_FOUND,
    '找不到這筆費用所屬的分帳群組',
    '可能是你已經被移出該群組，請到網頁確認'
  );
}

/** 找出登入者在這個群組裡連結的成員 */
export async function resolveSelf(group) {
  const user = await getCurrentUser();
  const self = (group.split_members || []).find((m) => m.user_id === user.id);
  if (self) return self;

  throw smfError(
    ErrorCode.NOT_FOUND,
    `你在群組「${group.name}」裡沒有連結的成員身分，無法用「我」代表自己`,
    '請到網頁把自己連結到成員，或改用 --paid-by／--split 指定實際的成員名稱'
  );
}

export function memberNameList(group) {
  const names = (group.split_members || []).map((m) => m.name);
  return names.length ? names.join('、') : '（這個群組還沒有成員）';
}

/**
 * 名稱 → 成員。
 *
 * me / 我 / 自己 會解析成登入者連結的成員：使用者說的是「我跟小明吃飯」，
 * 但他在群組裡的成員名可能叫「Doris」，少了這個特例，最常見的那句話會直接失敗。
 * 真的有成員就叫「我」時，成員名優先（比對真實名稱在前）。
 */
export async function resolveMember(group, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    throw smfError(
      ErrorCode.INVALID_INPUT,
      '必須指定成員名稱',
      `群組「${group.name}」的成員：${memberNameList(group)}（可用 me 代表自己）`
    );
  }

  const members = group.split_members || [];
  const matches = members.filter((m) => m.name === trimmed);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw smfError(
      ErrorCode.INVALID_INPUT,
      `群組「${group.name}」裡有多位成員都叫「${trimmed}」，無法判斷是哪一位`,
      '請到網頁把其中一位改名以便區分'
    );
  }

  if (SELF_ALIASES.includes(trimmed.toLowerCase())) return resolveSelf(group);

  throw smfError(
    ErrorCode.MEMBER_NOT_FOUND,
    `群組「${group.name}」裡找不到成員「${trimmed}」`,
    `這個群組的成員：${memberNameList(group)}（可用 me 代表自己）`
  );
}

/**
 * 封存的群組一律禁止寫入。
 * 這與網頁一致：SplitGroupDetail 在 isArchived 時把費用設為唯讀，還款與新增入口全部關閉。
 */
export function assertNotArchived(group, action) {
  if (!group.archived_at) return;
  throw smfError(
    ErrorCode.INVALID_INPUT,
    `群組「${group.name}」已封存，無法${action}`,
    '請先到網頁取消封存，或改用其他群組'
  );
}
