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

  // 還款紀錄：from_member 付了錢（balance +），to_member 收了錢（balance -）
  (settlementList || []).forEach(s => {
    const fromRate = (rates && s.currency) ? (rates[s.currency] ?? 1) : 1;
    const factor = toRate > 0 ? fromRate / toRate : 1;
    const amt = Number(s.amount) * factor;

    balance[s.from_member] = (balance[s.from_member] || 0) + amt;
    balance[s.to_member] = (balance[s.to_member] || 0) - amt;
  });

  // 分成債主（balance > 0）和欠款人（balance < 0）
  const creditors = [];
  const debtors = [];
  Object.entries(balance).forEach(([id, bal]) => {
    const rounded = Math.round(bal * 100) / 100;
    if (rounded > 0.01) creditors.push({ id, amount: rounded });
    else if (rounded < -0.01) debtors.push({ id, amount: -rounded });
  });

  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  const transactions = [];
  let ci = 0, di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const pay = Math.min(creditors[ci].amount, debtors[di].amount);
    transactions.push({
      fromId: debtors[di].id,
      toId: creditors[ci].id,
      amount: Math.round(pay * 100) / 100,
    });
    creditors[ci].amount -= pay;
    debtors[di].amount -= pay;
    if (creditors[ci].amount < 0.01) ci++;
    if (debtors[di].amount < 0.01) di++;
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
