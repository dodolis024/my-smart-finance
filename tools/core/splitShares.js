import { ErrorCode, smfError } from './errors.js';
import { memberNameList, resolveMember } from './splitGroups.js';

/**
 * ⚠️ 均分的零頭規則是 src/components/split/AddExpenseModal.jsx 的第二份實作。
 * calcEqualShares（均分模式）與 autoShareFirst（自訂模式的自動分配）兩段都必須逐字對齊，
 * 否則同一筆除不盡的費用在網頁與 CLI 會差一分錢。
 * 修改前請先看 tools/README.md 的「同步義務」一節。
 */

/** 與 core/transactions.js 的 parseAmount 同款：容許使用者輸入含千分位逗號的金額 */
function parseShareAmount(raw, name) {
  const value = parseFloat(String(raw).replace(/,/g, ''));
  if (isNaN(value)) {
    throw smfError(
      ErrorCode.INVALID_INPUT,
      `「${name}」的固定金額不是有效數字（收到：${raw}）`,
      '寫法是「成員=金額」，例如 --split "我=200,小明,小美"'
    );
  }
  if (value < 0) {
    throw smfError(ErrorCode.INVALID_INPUT, `「${name}」的分攤金額不可為負數（收到：${raw}）`);
  }
  return value;
}

/** 均分模式：無條件捨去到分，零頭全部補給第一位參與者（對齊 calcEqualShares） */
function equalShares(amount, count) {
  const base = Math.floor((amount / count) * 100) / 100;
  const remainder = Math.round((amount - base * count) * 100) / 100;
  return { base, first: base + remainder };
}

/** 自訂模式的自動分配：對齊 autoShare / autoShareFirst，第一位多拿一次 round */
function autoShares(remaining, count) {
  const base = Math.floor((remaining / count) * 100) / 100;
  const remainder = Math.round((remaining - base * count) * 100) / 100;
  return { base, first: Math.round((base + remainder) * 100) / 100 };
}

/**
 * 對指定的參與者均分，回傳 [{ member_id, share }]。
 * 一律依群組成員順序排列，零頭給順序中的第一位。
 */
export function equalSharesFor(group, memberIds, amount) {
  const ids = new Set(memberIds);
  const participants = (group.split_members || []).filter((m) => ids.has(m.id));
  if (!participants.length) {
    throw smfError(
      ErrorCode.INVALID_INPUT,
      '這筆費用沒有任何分攤對象',
      `群組「${group.name}」的成員：${memberNameList(group)}`
    );
  }
  const { base, first } = equalShares(Number(amount), participants.length);
  return participants.map((m, i) => ({ member_id: m.id, share: i === 0 ? first : base }));
}

/**
 * 判斷既有分攤是不是「均分」。
 * 逐字對齊 AddExpenseModal 載入既有費用時的 isEqual：每個人的分攤不是 base 就是 base + 零頭。
 * edit 改金額時靠這個判斷能不能自動重算——判錯會把使用者一個一個喬出來的自訂金額沖掉。
 */
export function isEqualSplit(shares, amount) {
  const n = shares.length;
  if (!n) return false;
  const amt = Number(amount);
  const base = Math.floor((amt / n) * 100) / 100;
  const withRemainder = base + Math.round((amt - base * n) * 100) / 100;
  return shares.every(
    (s) => Math.abs(Number(s.share) - base) < 0.02 || Math.abs(Number(s.share) - withRemainder) < 0.02
  );
}

/**
 * 解析 --split 的三種寫法，回傳 [{ member_id, share }]。
 *
 *   （省略）            全體成員均分
 *   我,小明,小美        指定參與者均分
 *   我=200,小明,小美    我固定 200，其餘均分剩下的
 *   我=300,小明=700     全部固定，總和須等於金額
 *
 * 零頭一律依「群組成員順序」（created_at）決定誰拿，不是依 spec 的書寫順序：
 * 同一組人不論 agent 怎麼排列參數，結果都要一樣，也才與網頁一致。
 */
export async function parseSplitSpec({ spec, amount, group }) {
  const members = group.split_members || [];
  const total = Number(amount);

  // 沒指定參與者 = 全體成員均分
  if (spec === undefined || spec === null || String(spec).trim() === '') {
    if (!members.length) {
      throw smfError(
        ErrorCode.INVALID_INPUT,
        `群組「${group.name}」還沒有成員，無法分攤`,
        '請先到網頁把成員加進這個群組'
      );
    }
    return equalSharesFor(group, members.map((m) => m.id), total);
  }

  const segments = String(spec)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');

  if (!segments.length) {
    throw smfError(
      ErrorCode.INVALID_INPUT,
      '--split 沒有指定任何參與者',
      `群組「${group.name}」的成員：${memberNameList(group)}（可用 me 代表自己）`
    );
  }

  // 先逐段解析成員與固定金額，重複指定同一人要擋下——那通常代表 agent 把名單組錯了
  const fixed = new Map();
  const pending = new Set();
  const seen = new Set();

  for (const segment of segments) {
    const eq = segment.indexOf('=');
    const rawName = eq > 0 ? segment.slice(0, eq).trim() : segment;
    const member = await resolveMember(group, rawName);

    if (seen.has(member.id)) {
      throw smfError(
        ErrorCode.INVALID_INPUT,
        `--split 裡重複指定了成員「${member.name}」`,
        '每位參與者只能出現一次'
      );
    }
    seen.add(member.id);

    if (eq > 0) {
      fixed.set(member.id, parseShareAmount(segment.slice(eq + 1).trim(), member.name));
    } else {
      pending.add(member.id);
    }
  }

  // 依群組成員順序排好，零頭才會落在固定的那一位身上
  const participants = members.filter((m) => seen.has(m.id));
  const pendingOrdered = participants.filter((m) => pending.has(m.id));

  // 純名單（沒有任何等號）＝網頁的均分模式，走 equalShares；
  // 有等號才是自訂模式，未填的人走 autoShares。兩條路徑分開，才與網頁逐字對齊。
  if (!fixed.size) {
    return equalSharesFor(group, [...pending], total);
  }

  const fixedTotal = [...fixed.values()].reduce((sum, v) => sum + v, 0);
  const shares = new Map(fixed);

  if (pendingOrdered.length) {
    const remaining = Math.round((total - fixedTotal) * 100) / 100;
    if (remaining < 0) {
      throw smfError(
        ErrorCode.INVALID_INPUT,
        `固定金額總和 ${fixedTotal} 已超過總額 ${total}`,
        '請調降固定金額，或提高費用金額'
      );
    }
    const { base, first } = autoShares(remaining, pendingOrdered.length);
    pendingOrdered.forEach((m, i) => {
      shares.set(m.id, i === 0 ? first : base);
    });
  } else {
    // 全部都是固定金額：總和必須等於總額，容忍誤差 0.02（與網頁 customMismatch 同值）
    if (Math.abs(fixedTotal - total) > 0.02) {
      throw smfError(
        ErrorCode.INVALID_INPUT,
        `分攤總和與費用金額不符（總和 ${fixedTotal.toFixed(2)}，應為 ${total.toFixed(2)}）`,
        '請調整各人的固定金額，或改用不帶等號的寫法讓程式自動均分'
      );
    }
  }

  const result = participants.map((m) => ({ member_id: m.id, share: shares.get(m.id) }));

  const negative = result.find((s) => s.share < 0);
  if (negative) {
    const name = members.find((m) => m.id === negative.member_id)?.name || negative.member_id;
    throw smfError(
      ErrorCode.INVALID_INPUT,
      `「${name}」分到的金額是負數（${negative.share}）`,
      '固定金額的總和不能超過費用金額'
    );
  }

  return result;
}
