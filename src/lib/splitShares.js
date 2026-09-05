import { ZERO_DECIMAL_CURRENCIES } from './constants';

/**
 * ⚠️ 這個檔案是 tools/core/splitShares.js 的第二份實作。
 * 兩邊必須保持一致，否則同一筆除不盡的費用在網頁與 CLI 會分給不同的人。
 * 修改前請先看 tools/README.md 的「同步義務」一節。
 *
 * 與 CLI 的差別：CLI 那份還要處理 --split 語法與成員名稱解析，所以多包了
 * equalSharesFor / parseSplitSpec；除不盡時怎麼分、零頭給誰，是兩邊共用的部分。
 */

/**
 * 分攤送出前，總和與費用金額的容許誤差。
 * 分攤都已收斂到該幣別的最小單位，這裡只吸收浮點加總的雜訊，
 * 不該放行真的差一個單位——split_expense_shares 沒有 CHECK 約束，
 * 這裡放行就沒有人擋了。
 */
export const SHARE_SUM_TOLERANCE = 0.001;

/**
 * 費用金額的上限。
 * split_expenses.amount 與 split_expense_shares.share 都是 NUMERIC(12, 2)，
 * 也就是小數點前最多 10 位。超過會拿到資料庫的原始錯誤（numeric field overflow），
 * 使用者只會看到一串看不懂的英文，所以在前面就擋下來。
 */
export const MAX_SPLIT_AMOUNT = 9999999999.99;

/** 分攤的總和是否等於費用金額 */
export function sumMatchesAmount(total, amount) {
  return Math.abs(Number(total) - Number(amount)) <= SHARE_SUM_TOLERANCE;
}

/**
 * 該幣別的分攤要算到幾位小數。
 * 台幣、日圓等零小數幣別沒有比 1 元更小的單位，分到小數只會讓
 * 畫面顯示（formatSplitAmount 會收成整數）與實際存的數字對不起來：
 * 100 元三人分存成 33.34/33.33/33.33，畫面卻顯示 33/33/33 加起來只有 99。
 */
export function shareDecimals(currency) {
  return ZERO_DECIMAL_CURRENCIES.has(currency || 'TWD') ? 0 : 2;
}

/** 該幣別的最小單位：台幣 1 元、美金 0.01 元 */
export function shareUnit(currency) {
  return shareDecimals(currency) === 0 ? 1 : 0.01;
}

/**
 * 把金額收斂到該幣別的最小單位。
 * 零小數幣別若讓金額帶小數（台幣 100.5），整數分攤的加總永遠湊不回去，
 * 使用者會卡在一個怎麼調都過不了的「總和不符」錯誤。
 */
export function roundToCurrencyUnit(value, currency) {
  const scale = shareDecimals(currency) === 0 ? 1 : 100;
  return Math.round(Number(value) * scale) / scale;
}

/**
 * 零頭要從第幾位參與者開始分。
 *
 * 只依這筆費用自己身上的欄位計算，所以網頁與 CLI 一定算出同一個人，
 * 重新編輯、重新整理也不會換人。用雜湊而不是「第幾筆」是刻意的：
 * 序號會因為刪掉中間某筆費用而全部位移，而且 CLI 每次新增都要多查一次資料庫。
 *
 * 效果是長期輪流——固定從第一位開始的話，建群組的人會承擔絕大多數零頭。
 */
export function remainderOffset({ date, title, amount }, count) {
  if (!count) return 0;
  const key = `${date ?? ''}|${title ?? ''}|${amount ?? ''}`;
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % count;
}

/**
 * 均分：先每人分到相同的整數個最小單位，除不盡的零頭再以「一個單位」為單位，
 * 從 offset 開始依序分給連續幾位參與者。
 *
 * 回傳長度為 count 的陣列，位置對應參與者順序。
 * 任兩人最多只差一個最小單位——舊版是把零頭整包塞給第一位，
 * 換成整數分攤後那會變成 10 元 7 人分時第一位付 4 元、其他人各付 1 元。
 */
export function splitEqually(amount, count, { currency = 'TWD', offset = 0 } = {}) {
  if (!count) return [];
  const decimals = shareDecimals(currency);
  const scale = decimals === 0 ? 1 : 100;
  // 一律換算成「最小單位的整數個數」再分，全程整數運算，不會有浮點雜訊
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
 * 判斷既有分攤是不是「均分」。
 * 編輯既有費用時靠這個決定要開均分還是自訂模式——判錯會把使用者一個一個
 * 喬出來的自訂金額，在改金額時被自動重算沖掉。
 *
 * 比對的是「排序後的金額組合」而不是誰拿多少，所以不受 offset 影響。
 * 零小數幣別要額外認得舊資料：改成整數分攤之前，台幣是算到 2 位小數存的
 * （100 元三人分存成 33.34/33.33/33.33），那些費用仍然是均分，不能被改判成自訂。
 */
export function isEqualSplit(shares, amount, currency = 'TWD') {
  const n = shares.length;
  if (!n) return false;
  const actual = shares.map((s) => Number(s.share)).sort((a, b) => a - b);
  const matches = (expected) =>
    expected.every((v, i) => Math.abs(v - actual[i]) <= SHARE_SUM_TOLERANCE);

  const sorted = (arr) => [...arr].sort((a, b) => a - b);
  if (matches(sorted(splitEqually(amount, n, { currency })))) return true;
  // 舊資料：零小數幣別在改制前是用 2 位小數分的
  if (shareDecimals(currency) === 0) {
    return matches(sorted(splitEqually(amount, n, { currency: 'USD' })));
  }
  return false;
}
