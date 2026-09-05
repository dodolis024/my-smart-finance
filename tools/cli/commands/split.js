import { normalizeDate } from '../../core/dates.js';
import { ErrorCode, SmfError, smfError } from '../../core/errors.js';
import { parseAmount } from '../../core/transactions.js';
import {
  assertNotArchived,
  getGroupById,
  listGroups,
  memberNameList,
  resolveGroup,
  resolveMember,
  resolveSelf,
} from '../../core/splitGroups.js';
import {
  equalSharesFor,
  isEqualSplit,
  parseSplitSpec,
  MAX_SPLIT_AMOUNT,
  normalizeShares,
  remainderOffset,
  roundToCurrencyUnit,
} from '../../core/splitShares.js';
import {
  addExpense,
  addSettlement,
  deleteExpense,
  getExpense,
  getGroupReport,
  updateExpense,
} from '../../core/splitExpenses.js';
import { formatSplitAmount } from '../../core/splitSettlement.js';
import { printJson, table } from '../format.js';

export const SPLIT_HELP = `
分帳（finance split ...）

  finance split groups                     列出分帳群組與成員
  finance split show [群組] [--limit N]     費用明細與結算建議
  finance split add <項目> <金額> [--group 群組] [--paid-by 我]
      [--split 我,小明,小美]        指定參與者均分（省略＝全體均分）
      [--split "我=200,小明,小美"]   我固定 200，其餘均分剩下的
      [--split "我=300,小明=500"]    全部固定，總和須等於金額
      [--currency JPY] [--date today] [--note 備註] [--dry-run]
  finance split edit <費用id> [--title ...] [--amount 3500] [--split ...]
      [--paid-by ...] [--currency ...] [--date ...] [--note ...] [--dry-run]
  finance split settle --from 小明 --to 我 --amount 500 [--group 群組] [--currency TWD]
  finance split rm <費用id>

  --split 與 --paid-by 可用 me（或「我」）代表自己。
  群組名或項目名含空格時要加引號："日本 行"。
  任何子命令加上 --json 就輸出結構化資料（費用 id 為完整 UUID）。

  分帳費用不會自動計入個人收支。網頁另有「同步至個人帳本」可一次同步整個群組，
  所以不要再用 finance add 把同一筆重記一次，那會變成重複記帳。
  寫入前可加 --dry-run 先算給使用者確認，確認後再執行一次。
  建立群組、用邀請碼加入群組請到網頁操作。
`.trim();

const ALLOWED_FLAGS = {
  groups: ['json'],
  show: ['group', 'limit', 'json'],
  add: ['group', 'paid-by', 'split', 'currency', 'date', 'note', 'dry-run', 'json'],
  edit: ['title', 'amount', 'paid-by', 'split', 'currency', 'date', 'note', 'dry-run', 'json'],
  settle: ['from', 'to', 'amount', 'group', 'currency', 'json'],
  rm: ['json'],
};

/**
 * 旗標打錯就擋下來。
 *
 * 這是 --key=value 修正之後的第二道防線：`--splt 我,小明` 若被默默忽略，
 * agent 會拿到一筆「全群組均分」的帳，而且沒有任何跡象顯示它算錯了。
 * 只加在 split 指令，不動既有指令的行為。
 */
function assertKnownFlags(flags, allowed, command) {
  const unknown = Object.keys(flags).filter((k) => !allowed.includes(k));
  if (unknown.length) {
    throw smfError(
      ErrorCode.INVALID_INPUT,
      `${command} 不認識的參數：${unknown.map((k) => `--${k}`).join('、')}`,
      `可用的參數：${allowed.map((k) => `--${k}`).join('、')}`
    );
  }
}

/** `--split`（後面漏了值）會被解析成 true，這種寫法要擋下，不能當成「沒指定」 */
function valueOf(flags, key) {
  const value = flags[key];
  if (value === undefined) return undefined;
  if (value === true) {
    throw smfError(ErrorCode.INVALID_INPUT, `--${key} 後面要接一個值`);
  }
  return value;
}

/** 與 format.js 的 money 同樣的呈現，但小數位依幣別決定（日圓不會印成 ¥333.33） */
function amountText(amount, currency) {
  const code = String(currency || 'TWD').toUpperCase();
  const text = formatSplitAmount(Number(amount), code);
  return code === 'TWD' ? `NT$${text}` : `${text} ${code}`;
}

function memberName(group, memberId) {
  return (group.split_members || []).find((m) => m.id === memberId)?.name || '（已移除的成員）';
}

function sharesText(group, shares, currency) {
  return shares
    .map((s) => `${memberName(group, s.member_id)} ${amountText(s.share, currency)}`)
    .join('　');
}

function withNames(group, shares) {
  return shares.map((s) => ({
    member_id: s.member_id,
    name: memberName(group, s.member_id),
    share: s.share,
  }));
}

function normalizeCurrency(value, fallback) {
  return String(value || fallback || 'TWD').trim().toUpperCase();
}

/** 資料庫欄位是 NUMERIC(12,2)，超過會拿到看不懂的 numeric field overflow */
function assertAmountInRange(amount) {
  if (Number(amount) > MAX_SPLIT_AMOUNT) {
    throw smfError(
      ErrorCode.INVALID_INPUT,
      `金額超過可記錄的上限（${MAX_SPLIT_AMOUNT}）`,
      '請確認金額是否多打了位數'
    );
  }
}

function requireDate(value) {
  const normalized = normalizeDate(value);
  if (!normalized) {
    throw smfError(
      ErrorCode.INVALID_INPUT,
      `日期格式錯誤（收到：${value}）`,
      '請使用 YYYY-MM-DD，或 today / yesterday'
    );
  }
  return normalized;
}

async function groupsSubcommand({ flags }) {
  const groups = await listGroups();

  if (flags.json) return printJson(groups);

  if (!groups.length) {
    console.log('（你目前沒有任何分帳群組，請先到網頁建立）');
    return;
  }

  groups.forEach((group) => {
    const archived = group.archived_at ? '（已封存）' : '';
    console.log(`${group.name}（${group.currency}）${archived}｜成員：${memberNameList(group)}`);
  });
  console.log(`\n共 ${groups.length} 個群組`);
}

async function showSubcommand({ positional, flags }) {
  const group = await resolveGroup(positional[0] ?? valueOf(flags, 'group'));
  const report = await getGroupReport(group, { limit: valueOf(flags, 'limit') });
  const { expenses, expenseCount, memberTotals, settlement } = report;
  const members = group.split_members || [];

  if (flags.json) {
    return printJson({
      group: {
        id: group.id,
        name: group.name,
        currency: group.currency,
        default_expense_currency: group.default_expense_currency,
        archived_at: group.archived_at,
        members: members.map((m) => ({ id: m.id, name: m.name, user_id: m.user_id })),
      },
      expenses,
      expense_count: expenseCount,
      settlements: report.settlements,
      member_totals: members.map((m) => ({
        member_id: m.id,
        name: m.name,
        total: memberTotals[m.id] ?? 0,
      })),
      settlement,
    });
  }

  const archived = group.archived_at ? '（已封存）' : '';
  console.log(`\n${group.name}（${group.currency}）${archived}｜成員：${memberNameList(group)}\n`);

  const rows = expenses.map((expense) => ({
    date: expense.date,
    title: expense.title,
    payer: expense.paid_by ? memberName(group, expense.paid_by) : '－',
    amount: amountText(expense.amount, expense.currency),
    id: String(expense.id).slice(0, 8),
  }));

  console.log(
    table(rows, [
      { key: 'date', label: '日期' },
      { key: 'title', label: '項目' },
      { key: 'payer', label: '付款人' },
      { key: 'amount', label: '金額', align: 'right' },
      { key: 'id', label: 'id' },
    ])
  );

  if (expenseCount > expenses.length) {
    console.log(`共 ${expenseCount} 筆，顯示前 ${expenses.length} 筆`);
  } else {
    console.log(`共 ${expenseCount} 筆`);
  }

  console.log('\n每人總支出');
  console.log(
    `  ${members
      .map((m) => `${m.name} ${amountText(memberTotals[m.id] ?? 0, group.currency)}`)
      .join('　')}`
  );

  console.log('\n結算建議');
  if (!settlement.length) {
    console.log('  已結清');
    return;
  }
  settlement.forEach((s) => {
    console.log(`  ${s.from} 付給 ${s.to} ${amountText(s.amount, group.currency)}`);
  });
}

async function addSubcommand({ positional, flags }) {
  const [title, rawAmount] = positional;
  if (!String(title || '').trim()) {
    throw smfError(
      ErrorCode.INVALID_INPUT,
      '必須指定項目名稱',
      '寫法是 finance split add <項目> <金額>；項目含空格時要加引號'
    );
  }
  const amount = parseAmount(rawAmount);
  assertAmountInRange(amount);

  const group = await resolveGroup(valueOf(flags, 'group'));
  assertNotArchived(group, '新增費用');

  const paidByName = valueOf(flags, 'paid-by');
  const paidBy = paidByName ? await resolveMember(group, paidByName) : await resolveSelf(group);

  const currency = normalizeCurrency(
    valueOf(flags, 'currency'),
    group.default_expense_currency || group.currency
  );
  const date = requireDate(valueOf(flags, 'date'));
  const note = valueOf(flags, 'note') || null;
  const shares = await parseSplitSpec({
    spec: valueOf(flags, 'split'),
    amount: roundToCurrencyUnit(amount, currency),
    group,
    currency,
    date,
    title: String(title).trim(),
  });

  // dry-run 擺在所有驗證跑完之後：agent 拿到的預覽必須就是真正會寫入的結果
  if (flags['dry-run']) {
    const preview = {
      dryRun: true,
      group_id: group.id,
      group_name: group.name,
      title: String(title).trim(),
      amount: roundToCurrencyUnit(amount, currency),
      currency,
      date,
      note,
      paid_by: paidBy.id,
      paid_by_name: paidBy.name,
      shares: withNames(group, shares),
    };
    if (flags.json) return printJson(preview);

    console.log(`（尚未寫入）${group.name}｜${String(title).trim()} ${amountText(amount, currency)}`);
    console.log(`  付款人 ${paidBy.name}｜${date}`);
    console.log(`  ${sharesText(group, shares, currency)}`);
    console.log('  確認無誤後，把 --dry-run 拿掉再執行一次即可寫入');
    return;
  }

  const result = await addExpense({
    group,
    title: String(title).trim(),
    amount: roundToCurrencyUnit(amount, currency),
    currency,
    date,
    note,
    paidBy: paidBy.id,
    shares,
  });

  if (flags.json) {
    return printJson({
      expense: result.expense,
      shares: withNames(group, shares),
      checkedIn: result.checkedIn,
    });
  }

  console.log(`✓ 已記錄分帳：${String(title).trim()} ${amountText(amount, currency)}（${group.name}）`);
  console.log(`  付款人 ${paidBy.name}｜${date}`);
  console.log(`  ${sharesText(group, shares, currency)}`);
  if (result.checkedIn) console.log('  今日已簽到 ✓');
  console.log(`  id: ${result.expense?.id ?? '（未取得）'}`);
}

async function editSubcommand({ positional, flags }) {
  const expense = await getExpense(positional[0]);
  const group = await getGroupById(expense.group_id);
  assertNotArchived(group, '修改費用');

  const originalShares = (expense.split_expense_shares || []).map((s) => ({
    member_id: s.member_id,
    share: Number(s.share),
  }));

  const rawTitle = valueOf(flags, 'title');
  const title = rawTitle === undefined ? expense.title : String(rawTitle).trim();
  if (!title) throw smfError(ErrorCode.INVALID_INPUT, '項目名稱不可為空');

  const amountChanged = valueOf(flags, 'amount') !== undefined;
  const rawAmount = amountChanged ? parseAmount(flags.amount) : Number(expense.amount);
  assertAmountInRange(rawAmount);
  const currency = normalizeCurrency(valueOf(flags, 'currency'), expense.currency);
  // 與 parseSplitSpec 用同一個收斂後的金額，否則分攤加總會對不回費用金額
  const amount = roundToCurrencyUnit(rawAmount, currency);
  const date = flags.date === undefined ? expense.date : requireDate(valueOf(flags, 'date'));
  const rawNote = valueOf(flags, 'note');
  const note = rawNote === undefined ? expense.note : rawNote || null;

  const paidByName = valueOf(flags, 'paid-by');
  const paidBy = paidByName ? (await resolveMember(group, paidByName)).id : expense.paid_by;

  const spec = valueOf(flags, 'split');
  let shares;
  if (spec !== undefined) {
    shares = await parseSplitSpec({ spec, amount, group, currency, date, title });
  } else if (!amountChanged) {
    // update_split_expense 要求 p_shares 非空，只改標題時也得把原分攤送回去。
    // 順手收斂到幣別單位：舊資料可能存著台幣小數，與網頁的處理保持一致。
    shares = normalizeShares(originalShares, amount, currency);
  } else if (isEqualSplit(originalShares, Number(expense.amount), expense.currency)) {
    shares = equalSharesFor(group, originalShares.map((s) => s.member_id), amount, {
      currency,
      offset: remainderOffset({ date, title, amount }, originalShares.length),
    });
  } else {
    // 自訂分攤是使用者一個一個喬出來的數字，靜默沖掉重新均分他不會發現，
    // 但每個人該付多少全變了——所以直接擋下，並把原數字列出來讓 agent 據以重算
    throw smfError(
      ErrorCode.INVALID_INPUT,
      '這筆費用是自訂分攤，改金額時必須一併用 --split 指定新的分攤',
      `原本的分攤：${originalShares
        .map((s) => `${memberName(group, s.member_id)}=${s.share}`)
        .join('、')}`
    );
  }

  const beforeText = `${expense.title} ${amountText(expense.amount, expense.currency)}｜${expense.date}｜${sharesText(group, originalShares, expense.currency)}`;
  const afterText = `${title} ${amountText(amount, currency)}｜${date}｜${sharesText(group, shares, currency)}`;

  if (flags['dry-run']) {
    if (flags.json) {
      return printJson({
        dryRun: true,
        before: expense,
        after: {
          id: expense.id,
          group_id: group.id,
          title,
          amount,
          currency,
          date,
          note,
          paid_by: paidBy,
          shares: withNames(group, shares),
        },
      });
    }
    console.log('（尚未寫入）');
    console.log(`  之前：${beforeText}`);
    console.log(`  之後：${afterText}`);
    console.log('  確認無誤後，把 --dry-run 拿掉再執行一次即可寫入');
    return;
  }

  const updated = await updateExpense({
    group,
    expenseId: expense.id,
    title,
    amount,
    currency,
    date,
    note,
    paidBy,
    shares,
  });

  if (flags.json) return printJson({ before: expense, after: updated });

  console.log('✓ 已更新');
  console.log(`  之前：${beforeText}`);
  console.log(`  之後：${afterText}`);
}

async function settleSubcommand({ flags }) {
  const fromName = valueOf(flags, 'from');
  const toName = valueOf(flags, 'to');
  const rawAmount = valueOf(flags, 'amount');

  if (!fromName || !toName || rawAmount === undefined) {
    throw smfError(
      ErrorCode.INVALID_INPUT,
      'settle 需要 --from、--to、--amount 三個參數',
      '寫法是 finance split settle --from 付錢的人 --to 收錢的人 --amount 金額'
    );
  }
  const amount = parseAmount(rawAmount);
  assertAmountInRange(amount);

  const group = await resolveGroup(valueOf(flags, 'group'));
  assertNotArchived(group, '記錄還款');

  const fromMember = await resolveMember(group, fromName);
  const toMember = await resolveMember(group, toName);
  if (fromMember.id === toMember.id) {
    throw smfError(ErrorCode.INVALID_INPUT, `--from 與 --to 是同一位成員（${fromMember.name}）`);
  }

  const currency = normalizeCurrency(valueOf(flags, 'currency'), group.currency);
  const result = await addSettlement({ group, fromMember, toMember, amount, currency });

  if (flags.json) return printJson(result);

  console.log(`✓ 已記錄還款：${fromMember.name} 付給 ${toMember.name} ${amountText(amount, currency)}（${group.name}）`);
  console.log(`  id: ${result.settlement?.id ?? '（未取得）'}`);
}

async function rmSubcommand({ positional, flags }) {
  const expense = await getExpense(positional[0]);
  const group = await getGroupById(expense.group_id);
  assertNotArchived(group, '刪除費用');

  const result = await deleteExpense({ group, expense });

  if (flags.json) return printJson(result);

  const { deleted } = result;
  console.log('✓ 已刪除分帳費用');
  console.log(`  ${deleted.date} ${deleted.title} ${amountText(deleted.amount, deleted.currency)}（${group.name}）`);
}

const SUBCOMMANDS = {
  groups: groupsSubcommand,
  show: showSubcommand,
  add: addSubcommand,
  edit: editSubcommand,
  settle: settleSubcommand,
  rm: rmSubcommand,
  delete: rmSubcommand,
};

async function runSplit({ positional, flags }) {
  const [sub, ...rest] = positional;

  // 不帶子命令時印分帳專屬的 help：agent 探索指令時很自然會這樣試
  if (!sub) {
    console.log(SPLIT_HELP);
    return;
  }

  const handler = SUBCOMMANDS[sub];
  if (!handler) {
    throw smfError(
      ErrorCode.INVALID_INPUT,
      `不認識的分帳子命令：${sub}`,
      `可用的子命令：${Object.keys(ALLOWED_FLAGS).join('、')}`
    );
  }

  assertKnownFlags(flags, ALLOWED_FLAGS[sub === 'delete' ? 'rm' : sub], `finance split ${sub}`);
  await handler({ positional: rest, flags });
}

/**
 * --json 模式下錯誤也要是 JSON：agent 解析不了純文字的錯誤，只會拿另一個猜測再試一次。
 * 只在 split 這條路徑處理，index.js 的全域行為維持原樣，以免影響既有指令。
 */
export async function splitCommand({ positional, flags }) {
  try {
    await runSplit({ positional, flags });
  } catch (error) {
    if (!flags.json) throw error;

    const payload =
      error instanceof SmfError
        ? error.toJSON()
        : { error: ErrorCode.DB_ERROR, message: error.message || '未知的錯誤' };
    console.error(JSON.stringify(payload, null, 2));
    process.exitCode = 1;
  }
}
