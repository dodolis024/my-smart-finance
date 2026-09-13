import {
  addTransaction,
  deleteTransaction,
  listTransactions,
  updateTransaction,
} from '../../core/transactions.js';
import { ErrorCode, smfError } from '../../core/errors.js';
import { money, printJson, table } from '../format.js';

/**
 * --overseas / --no-overseas 是開關，不接值。
 * args.js 會把 --overseas 後面緊接的字當成值吃掉（例如 `--overseas 1200` 會吃掉金額），
 * 所以收到字串值一律報錯，不要猜使用者的意思。
 */
export function parseOverseasFlag(flags) {
  const on = flags.overseas;
  const off = flags['no-overseas'];
  if (on !== undefined && on !== true) {
    throw smfError(ErrorCode.INVALID_INPUT, `--overseas 是開關，不接值（收到：${on}）`, '把 --overseas 放在指令最後，並確認金額沒有被吃掉');
  }
  if (off !== undefined && off !== true) {
    throw smfError(ErrorCode.INVALID_INPUT, `--no-overseas 是開關，不接值（收到：${off}）`, '把 --no-overseas 放在指令最後');
  }
  if (on && off) throw smfError(ErrorCode.INVALID_INPUT, '--overseas 與 --no-overseas 不能同時使用');
  if (on) return true;
  if (off) return false;
  return undefined;
}

/** 有海外手續費時附註在台幣金額後面 */
function feeSuffix(tx) {
  return tx.overseas_fee != null ? `，含海外手續費 NT$${money(tx.overseas_fee)}` : '';
}

export async function addCommand({ positional, flags }) {
  const [itemName, amount] = positional;

  const result = await addTransaction({
    itemName,
    amount,
    category: flags.category || flags.c,
    type: flags.type,
    account: flags.account || flags.a,
    currency: flags.currency || 'TWD',
    date: flags.date,
    time: flags.time,
    note: flags.note,
    overseas: parseOverseasFlag(flags),
  });

  if (flags.json) return printJson(result);

  const { transaction, checkedIn } = result;
  const label = transaction.type === 'income' ? '收入' : '支出';
  // 台幣交易平常不顯示換算；有手續費時要顯示，否則看不出記進去的是含手續費的金額
  const converted =
    transaction.currency === 'TWD' && transaction.overseas_fee == null
      ? ''
      : `（約 NT$${money(transaction.twd_amount)}${feeSuffix(transaction)}）`;

  console.log(`✓ 已記錄${label}：${transaction.item_name} ${money(transaction.amount, transaction.currency)}${converted}`);
  console.log(`  ${transaction.date} ${transaction.time}｜${transaction.category}｜${transaction.payment_method}`);
  if (checkedIn) console.log('  今日已簽到 ✓');
  console.log(`  id: ${transaction.id}`);
}

export async function listCommand({ flags }) {
  const rows = await listTransactions({
    month: flags.month,
    year: flags.year,
    from: flags.from,
    to: flags.to,
    type: flags.type,
    category: flags.category,
    search: flags.search,
    limit: flags.limit,
  });

  if (flags.json) return printJson(rows);

  const formatted = rows.map((tx) => ({
    date: tx.date,
    item: tx.item_name,
    category: tx.category,
    account: tx.payment_method || '－',
    amount: `${tx.type === 'income' ? '+' : '-'}${money(tx.amount, tx.currency)}`,
    id: tx.id.slice(0, 8),
  }));

  console.log(
    table(formatted, [
      { key: 'date', label: '日期' },
      { key: 'item', label: '項目' },
      { key: 'category', label: '分類' },
      { key: 'account', label: '帳戶' },
      { key: 'amount', label: '金額', align: 'right' },
      { key: 'id', label: 'id' },
    ])
  );

  if (rows.length > 0) {
    const total = rows.reduce((sum, tx) => sum + (tx.type === 'income' ? 1 : -1) * Number(tx.twd_amount), 0);
    console.log(`\n共 ${rows.length} 筆，淨額 NT$${money(total)}`);
  }
}

export async function editCommand({ positional, flags }) {
  const [id] = positional;
  const overseas = parseOverseasFlag(flags);

  const result = await updateTransaction(id, {
    ...(flags.item !== undefined ? { itemName: flags.item } : {}),
    ...(flags.amount !== undefined ? { amount: flags.amount } : {}),
    ...(flags.category !== undefined ? { category: flags.category } : {}),
    ...(flags.type !== undefined ? { type: flags.type } : {}),
    ...(flags.account !== undefined ? { account: flags.account } : {}),
    ...(flags.currency !== undefined ? { currency: flags.currency } : {}),
    ...(flags.date !== undefined ? { date: flags.date } : {}),
    ...(flags.time !== undefined ? { time: flags.time } : {}),
    ...(flags.note !== undefined ? { note: flags.note } : {}),
    ...(overseas !== undefined ? { overseas } : {}),
  });

  if (flags.json) return printJson(result);

  const { before, after } = result;
  console.log('✓ 已更新');
  const fee = (tx) => (tx.overseas_fee != null ? `（NT$${money(tx.twd_amount)}${feeSuffix(tx)}）` : '');
  console.log(`  之前：${before.item_name} ${money(before.amount, before.currency)}${fee(before)}｜${before.category}｜${before.date}`);
  console.log(`  之後：${after.item_name} ${money(after.amount, after.currency)}${fee(after)}｜${after.category}｜${after.date}`);
}

export async function removeCommand({ positional, flags }) {
  const [id] = positional;
  const result = await deleteTransaction(id);

  if (flags.json) return printJson(result);

  const { deleted } = result;
  console.log('✓ 已刪除');
  console.log(`  ${deleted.date} ${deleted.item_name} ${money(deleted.amount, deleted.currency)}｜${deleted.category}`);
}
