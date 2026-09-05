/**
 * ⚠️ 這個檔案是 tools/core/splitShares.js 的第二份實作。
 * 兩邊必須保持一致，否則同一筆除不盡的費用在網頁與 CLI 會差一分錢。
 * 修改前請先看 tools/README.md 的「同步義務」一節。
 *
 * 與 CLI 的差別：CLI 那份還要處理 --split 語法與成員名稱解析，所以多包了
 * equalSharesFor / parseSplitSpec；除不盡時零頭給誰的規則是兩邊共用的部分，
 * 也就是這裡的 equalShares / autoShares / isEqualSplit。
 */

/** 均分模式：無條件捨去到分，零頭全部補給第一位參與者 */
export function equalShares(amount, count) {
  const base = Math.floor((amount / count) * 100) / 100;
  const remainder = Math.round((amount - base * count) * 100) / 100;
  return { base, first: base + remainder };
}

/** 自訂模式的自動分配：與 equalShares 同規則，但第一位多拿一次 round */
export function autoShares(remaining, count) {
  const base = Math.floor((remaining / count) * 100) / 100;
  const remainder = Math.round((remaining - base * count) * 100) / 100;
  return { base, first: Math.round((base + remainder) * 100) / 100 };
}

/**
 * 判斷既有分攤是不是「均分」。
 * 編輯既有費用時靠這個決定要開均分還是自訂模式——判錯會把使用者一個一個
 * 喬出來的自訂金額，在改金額時被自動重算沖掉。
 */
export function isEqualSplit(shares, amount) {
  const n = shares.length;
  if (!n) return false;
  const { base, first } = equalShares(Number(amount), n);
  return shares.every(
    (s) => Math.abs(Number(s.share) - base) < 0.02 || Math.abs(Number(s.share) - first) < 0.02
  );
}
