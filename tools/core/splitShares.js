import { ErrorCode, smfError } from './errors.js';
import { memberNameList, resolveMember } from './splitGroups.js';
import { ZERO_DECIMAL_CURRENCIES } from './splitSettlement.js';

/**
 * ⚠️ 分攤規則（splitEqually / isEqualSplit / remainderOffset / shareDecimals /
 * roundToCurrencyUnit / SHARE_SUM_TOLERANCE）是 src/lib/splitShares.js 的第二份實作，
 * 都必須逐字對齊，否則同一筆費用在網頁與 CLI 會分出不同的數字、或分給不同的人。
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

/**
 * 分攤總和與費用金額的容許誤差（對齊 src/lib/splitShares.js）。
 * 分攤都已收斂到該幣別的最小單位，這裡只吸收浮點雜訊，不放行真的差一個單位。
 */
export const SHARE_SUM_TOLERANCE = 0.001;

/**
 * 費用金額的上限（對齊 src/lib/splitShares.js）。
 * split_expenses.amount 與 split_expense_shares.share 都是 NUMERIC(12, 2)，
 * 超過會拿到資料庫的原始錯誤（numeric field overflow）。
 */
export const MAX_SPLIT_AMOUNT = 9999999999.99;

/** 該幣別的分攤要算到幾位小數：台幣、日圓等零小數幣別沒有比 1 元更小的單位 */
export function shareDecimals(currency) {
  return ZERO_DECIMAL_CURRENCIES.has(currency || 'TWD') ? 0 : 2;
}

/** 把金額收斂到該幣別的最小單位，否則整數分攤的加總永遠湊不回去 */
export function roundToCurrencyUnit(value, currency) {
  const scale = shareDecimals(currency) === 0 ? 1 : 100;
  return Math.round(Number(value) * scale) / scale;
}

/**
 * 零頭要從第幾位參與者開始分。只依這筆費用自己身上的欄位計算，
 * 網頁與 CLI 才會分給同一個人；效果是長期輪流，不會永遠壓在第一位身上。
 */
export function remainderOffset({ date, title, amount }, count) {
  if (!count) return 0;
  const key = `${date ?? ''}|${title ?? ''}|${amount ?? ''}`;
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % count;
}

/**
 * 均分：每人先分到相同的整數個最小單位，零頭再以「一個單位」為單位，
 * 從 offset 開始依序分給連續幾位。回傳長度為 count 的陣列，對應參與者順序。
 * 任兩人最多只差一個最小單位。
 */
export function splitEqually(amount, count, { currency = 'TWD', offset = 0 } = {}) {
  if (!count) return [];
  const decimals = shareDecimals(currency);
  const scale = decimals === 0 ? 1 : 100;
  const totalUnits = Math.round(Number(amount) * scale);
  const base = Math.floor(totalUnits / count);
  const remainder = totalUnits - base * count;

  const start = ((offset % count) + count) % count;
  return Array.from({ length: count }, (_, i) => {
    const position = ((i - start) % count + count) % count;
    const units = base + (position < remainder ? 1 : 0);
    return decimals === 0 ? units : units / scale;
  });
}

/**
 * 對指定的參與者均分，回傳 [{ member_id, share }]。
 * 一律依群組成員順序排列；零頭從 offset 那一位開始、一人一個最小單位往後發。
 */
export function equalSharesFor(group, memberIds, amount, { currency = 'TWD', offset = 0 } = {}) {
  const ids = new Set(memberIds);
  const participants = (group.split_members || []).filter((m) => ids.has(m.id));
  if (!participants.length) {
    throw smfError(
      ErrorCode.INVALID_INPUT,
      '這筆費用沒有任何分攤對象',
      `群組「${group.name}」的成員：${memberNameList(group)}`
    );
  }
  const values = splitEqually(Number(amount), participants.length, { currency, offset });
  return participants.map((m, i) => ({ member_id: m.id, share: values[i] }));
}

/**
 * 把既有分攤收斂到該幣別的最小單位，並保證總和仍等於費用金額。
 *
 * 顧的是改制前存下的舊資料：台幣曾經可以存小數（50.5／30／19.5），
 * 直接載入編輯會過不了總和檢查，使用者連改個標題都存不回去，
 * 而畫面上也看不出該改哪裡。差額一律補在金額最大的那一筆。
 */
export function normalizeShares(shares, amount, currency) {
  if (!shares.length) return [];
  const rounded = shares.map((s) => ({ ...s, share: roundToCurrencyUnit(s.share, currency) }));
  const target = roundToCurrencyUnit(amount, currency);
  const diff = roundToCurrencyUnit(target - rounded.reduce((sum, s) => sum + s.share, 0), currency);
  if (diff === 0) return rounded;

  let biggest = 0;
  rounded.forEach((s, i) => { if (s.share > rounded[biggest].share) biggest = i; });
  rounded[biggest] = {
    ...rounded[biggest],
    share: roundToCurrencyUnit(rounded[biggest].share + diff, currency),
  };
  return rounded;
}

/**
 * 判斷既有分攤是不是「均分」。逐字對齊 src/lib/splitShares.js 的 isEqualSplit。
 * 比對排序後的金額組合而不是誰拿多少，所以不受 offset 影響；
 * 零小數幣別要額外認得改制前用 2 位小數分的舊資料，否則舊費用會被改判成自訂分攤。
 * edit 改金額時靠這個判斷能不能自動重算——判錯會把使用者喬出來的自訂金額沖掉。
 */
export function isEqualSplit(shares, amount, currency = 'TWD') {
  const n = shares.length;
  if (!n) return false;
  const actual = shares.map((s) => Number(s.share)).sort((a, b) => a - b);
  const sorted = (arr) => [...arr].sort((a, b) => a - b);
  const matches = (expected) =>
    expected.every((v, i) => Math.abs(v - actual[i]) <= SHARE_SUM_TOLERANCE);

  if (matches(sorted(splitEqually(amount, n, { currency })))) return true;
  if (shareDecimals(currency) === 0) {
    return matches(sorted(splitEqually(amount, n, { currency: 'USD' })));
  }
  return false;
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
export async function parseSplitSpec({ spec, amount, group, currency = 'TWD', date, title }) {
  const members = group.split_members || [];
  // 收斂到幣別單位：零小數幣別若讓金額帶小數，整數分攤永遠湊不回這個數字。
  // 呼叫端寫入時也要用同一個值，否則費用金額與分攤加總會對不起來。
  const total = roundToCurrencyUnit(amount, currency);

  // 沒指定參與者 = 全體成員均分
  if (spec === undefined || spec === null || String(spec).trim() === '') {
    if (!members.length) {
      throw smfError(
        ErrorCode.INVALID_INPUT,
        `群組「${group.name}」還沒有成員，無法分攤`,
        '請先到網頁把成員加進這個群組'
      );
    }
    return equalSharesFor(group, members.map((m) => m.id), total, {
      currency,
      offset: remainderOffset({ date, title, amount: total }, members.length),
    });
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
      fixed.set(
        member.id,
        roundToCurrencyUnit(parseShareAmount(segment.slice(eq + 1).trim(), member.name), currency)
      );
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
    return equalSharesFor(group, [...pending], total, {
      currency,
      offset: remainderOffset({ date, title, amount: total }, pending.size),
    });
  }

  const fixedTotal = [...fixed.values()].reduce((sum, v) => sum + v, 0);
  const shares = new Map(fixed);

  if (pendingOrdered.length) {
    const remaining = roundToCurrencyUnit(total - fixedTotal, currency);
    if (remaining < 0) {
      throw smfError(
        ErrorCode.INVALID_INPUT,
        `固定金額總和 ${fixedTotal} 已超過總額 ${total}`,
        '請調降固定金額，或提高費用金額'
      );
    }
    const autoValues = splitEqually(remaining, pendingOrdered.length, {
      currency,
      offset: remainderOffset({ date, title, amount: total }, pendingOrdered.length),
    });
    pendingOrdered.forEach((m, i) => {
      shares.set(m.id, autoValues[i]);
    });
  } else {
    // 全部都是固定金額：總和必須等於總額（容差與網頁 customMismatch 同值）
    if (Math.abs(fixedTotal - total) > SHARE_SUM_TOLERANCE) {
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
