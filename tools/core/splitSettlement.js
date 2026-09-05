/**
 * ⚠️ 這個檔案是 src/lib/splitSettlement.js 的第二份實作。
 * 兩邊必須保持一致，否則同一群組的結算金額在網頁與 CLI 會不同。
 * 修改前請先看 tools/README.md 的「同步義務」一節。
 *
 * 與前端唯一的差別：ZERO_DECIMAL_CURRENCIES 直接定義在這裡，
 * 因為 tools/ 是獨立發布的 npm 套件，不能相依 src/。
 * 名單來源是 src/lib/constants.js，改動時兩邊都要改。
 */

export const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW',
  'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
  'TWD',
]);

/** 該幣別可以實際交付的最小面額：台幣 1 元、美金 0.01 元 */
function settlementUnit(currency) {
  return ZERO_DECIMAL_CURRENCIES.has(currency || 'TWD') ? 1 : 0.01;
}

/**
 * 把餘額收斂成「整數個最小面額」，一律往遠離零的方向進位。
 *
 * 欠款人因此付得比實際欠的多一點，代墊的人則收得比應收多一點——
 * 代墊的人已經先掏錢了，換匯湊整的零頭不該由他吸收。
 * 多付的部分不會變成新的債務，見 forgiveRoundingResidue。
 */
function quantizeBalances(balance, unit) {
  // 雜訊底線：小到連一個面額的百分之一都不到的餘額，是浮點運算的殘渣而不是真的債，
  // 沒有這道底線，0.005 元的殘差會被進位成一筆 1 元的假交易。
  const noise = unit * 0.01;
  return Object.fromEntries(
    Object.entries(balance).map(([id, bal]) => {
      if (Math.abs(Number(bal)) < noise) return [id, 0];
      // 先收掉浮點雜訊：33.33 / 0.01 在浮點下是 3332.9999...
      const units = Math.round((Number(bal) / unit) * 1e6) / 1e6;
      return [id, units >= 0 ? Math.ceil(units) : -Math.ceil(-units)];
    })
  );
}

/**
 * 平了就是平了：付款方為了湊整而多付的那一點，不回頭算成「對方反過來欠他」。
 *
 * 沒有這一段，進位就永遠結不完——A 應收 1049.895、實收 1050，重新計算餘額時
 * 他會變成欠 0.105，畫面又冒出一筆待結算，付掉又反彈，無限循環。
 *
 * 只吸收「因為湊整而翻面」的餘額：原本欠錢的人變成有人欠他、或原本被欠的人
 * 變成欠別人，且金額不超過他經手的還款筆數 × 一個面額。
 * 這樣才不會把「還款金額被誤記成十倍」這種真的該追的差額一起吃掉。
 */
function forgiveRoundingResidue(balance, expenseBalance, unit) {
  // 上限的推導（不是拍腦袋的數字）：
  //   1. quantizeBalances 一律往遠離零的方向進位，每個人最多偏離「1 個面額」。
  //   2. 補足差額時，欠款人總共多分到的單位數少於「債主人數」，最壞情況全落在同一人身上。
  // 兩者相加，任何人因為湊整而產生的偏移都小於「(人數 + 1) 個面額」。
  //   代墊者那側更小（收款被上限卡在應收進位後的金額，偏移不到 1 個面額）。
  // 抓這個上限，才不會把「還款金額被誤記」這種真的該追的差額一起吃掉。
  const slack = (Object.keys(balance).length + 1) * unit;
  Object.keys(balance).forEach((id) => {
    const before = expenseBalance[id] || 0;
    const after = balance[id];
    if (before === 0 || after === 0) return;
    if (Math.sign(after) === Math.sign(before)) return;
    if (Math.abs(after) <= slack) balance[id] = 0;
  });
}

/**
 * Format an amount for display in the given currency
 * (zero-decimal currencies show no decimal places, others show two).
 *
 * @param {number} amount
 * @param {string} currency
 * @returns {string}
 */
export function formatSplitAmount(amount, currency) {
  const d = ZERO_DECIMAL_CURRENCIES.has(currency || 'TWD') ? 0 : 2;
  const rounded = Number(amount.toFixed(d));
  return rounded.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

/**
 * Per-member total spend (sum of own shares), converted to the group currency.
 *
 * @param {Array} members - [{ id, name }]
 * @param {Array} expenseList - expenses with split_expense_shares
 * @param {Object} rates - { TWD: 1, USD: 31.5, ... } (1 unit = how many TWD)
 * @param {string} groupCurrency - target currency for totals
 * @returns {Object} { [memberId]: number }
 */
export function calcMemberTotals(members, expenseList, rates, groupCurrency) {
  const totals = {};
  members.forEach(m => { totals[m.id] = 0; });
  const toRate = (rates && groupCurrency) ? (rates[groupCurrency] ?? 1) : 1;
  expenseList.forEach(expense => {
    const fromRate = (rates && expense.currency) ? (rates[expense.currency] ?? 1) : 1;
    const factor = toRate > 0 ? fromRate / toRate : 1;
    (expense.split_expense_shares || []).forEach(s => {
      totals[s.member_id] = (totals[s.member_id] || 0) + Number(s.share) * factor;
    });
  });
  return totals;
}

/**
 * Minimize-transactions settlement algorithm (greedy matching).
 *
 * @param {Array} members - [{ id, name }]
 * @param {Array} expenseList - expenses with split_expense_shares
 * @param {Array} settlementList - existing settlement records
 * @param {Object} rates - { TWD: 1, USD: 31.5, ... } (1 unit = how many TWD)
 * @param {string} settlementCurrency - target currency for settlement
 * @returns {Array} [{ fromId, toId, from, to, amount }]
 */
export function calcSettlement(members, expenseList, settlementList, rates, settlementCurrency) {
  const balance = {};
  members.forEach(m => { balance[m.id] = 0; });

  const toRate = (rates && settlementCurrency) ? (rates[settlementCurrency] ?? 1) : 1;

  // 費用：付款人 +amount，參與者 -share
  expenseList.forEach(expense => {
    const fromRate = (rates && expense.currency) ? (rates[expense.currency] ?? 1) : 1;
    const factor = toRate > 0 ? fromRate / toRate : 1;

    if (expense.paid_by) {
      balance[expense.paid_by] = (balance[expense.paid_by] || 0) + Number(expense.amount) * factor;
    }
    (expense.split_expense_shares || []).forEach(s => {
      balance[s.member_id] = (balance[s.member_id] || 0) - Number(s.share) * factor;
    });
  });

  // 只由費用產生的餘額，之後用來判斷誰是「原本就欠錢的人」
  const expenseBalance = { ...balance };

  // 還款紀錄：from_member 付了錢（balance +），to_member 收了錢（balance -）
  (settlementList || []).forEach(s => {
    const fromRate = (rates && s.currency) ? (rates[s.currency] ?? 1) : 1;
    const factor = toRate > 0 ? fromRate / toRate : 1;
    const amt = Number(s.amount) * factor;

    balance[s.from_member] = (balance[s.from_member] || 0) + amt;
    balance[s.to_member] = (balance[s.to_member] || 0) - amt;
  });

  // 先把每個人的餘額收斂成「整數個最小面額」，再開始配對。
  //
  // 為什麼不是在每一筆轉帳上進位：同一個人若要付好幾筆，每筆各自進位多付的零頭會累加，
  // 加起來超過一個面額之後，他反而變成債主，畫面又冒出一筆新的待結算——結不完。
  // 收斂餘額則是「一個人只被調整一次」，最多差一個面額，配對出來的轉帳一定是整數，
  // 付完就歸零。這也是「多付的當白送、不回頭再算」真正能成立的做法。
  //
  const unit = settlementUnit(settlementCurrency);
  // 先把「為了湊整而多付」造成的翻面餘額歸零，再收斂成整數面額
  forgiveRoundingResidue(balance, expenseBalance, unit);
  const quantized = quantizeBalances(balance, unit);

  // 分成債主（balance > 0）和欠款人（balance < 0）
  const creditors = [];
  const debtors = [];
  Object.entries(quantized).forEach(([id, units]) => {
    if (units > 0) creditors.push({ id, amount: units });
    else if (units < 0) debtors.push({ id, amount: -units });
  });

  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  // 兩邊都往上進位後，債主人數較多時欠款人付的總額可能不夠分，
  // 差額由欠款人補足——寧可欠款人多付幾元，也不要讓代墊的人少收。
  let shortfall = creditors.reduce((sum, c) => sum + c.amount, 0)
    - debtors.reduce((sum, d) => sum + d.amount, 0);
  for (let i = 0; shortfall > 0 && debtors.length; i++) {
    debtors[i % debtors.length].amount += 1;
    shortfall -= 1;
  }

  const transactions = [];
  let ci = 0, di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const pay = Math.min(creditors[ci].amount, debtors[di].amount);
    transactions.push({
      fromId: debtors[di].id,
      toId: creditors[ci].id,
      amount: Number((pay * unit).toFixed(2)),
    });
    creditors[ci].amount -= pay;
    debtors[di].amount -= pay;
    if (creditors[ci].amount === 0) ci++;
    if (debtors[di].amount === 0) di++;
  }

  const memberMap = Object.fromEntries(members.map(m => [m.id, m.name]));
  return transactions.map(t => ({
    fromId: t.fromId,
    toId: t.toId,
    from: memberMap[t.fromId] || t.fromId,
    to: memberMap[t.toId] || t.toId,
    amount: t.amount,
  }));
}
