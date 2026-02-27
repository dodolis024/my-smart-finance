/**
 * 信用卡帳單週期與使用額度計算
 */

export function calculateCreditUsage(account, history) {
  const billingDay = account.billing_day || account.billingDay;
  const paymentDueDay = account.payment_due_day || account.paymentDueDay;
  const accountId = account.id;
  const accountName = account.name || account.accountName;

  if (!billingDay) return 0;

  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;
  const currentDay = today.getDate();

  let lastBillingYear = currentYear;
  let lastBillingMonth = currentMonth;
  if (currentDay < billingDay) {
    lastBillingMonth -= 1;
    if (lastBillingMonth < 1) { lastBillingMonth = 12; lastBillingYear -= 1; }
  }

  let prevBillingYear = lastBillingYear;
  let prevBillingMonth = lastBillingMonth - 1;
  if (prevBillingMonth < 1) { prevBillingMonth = 12; prevBillingYear -= 1; }

  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

  const prevBillingDate = fmt(prevBillingYear, prevBillingMonth, billingDay);
  const lastBillingDate = fmt(lastBillingYear, lastBillingMonth, billingDay);

  let endDay = billingDay - 1;
  let endMonth = lastBillingMonth;
  let endYear = lastBillingYear;
  if (endDay < 1) {
    endMonth -= 1;
    if (endMonth < 1) { endMonth = 12; endYear -= 1; }
    endDay = new Date(endYear, endMonth, 0).getDate();
  }
  const lastBillingEndDate = fmt(endYear, endMonth, endDay);

  let hasPaid = false;
  if (paymentDueDay) {
    if (paymentDueDay > billingDay) {
      if (currentDay >= billingDay && currentDay >= paymentDueDay) hasPaid = true;
    } else {
      if (currentDay < billingDay && currentDay >= paymentDueDay) hasPaid = true;
    }
  }

  const todayDate = fmt(currentYear, currentMonth, currentDay);
  let totalUsed = 0;
  (history || []).forEach((tx) => {
    if (tx.type !== 'expense') return;
    const match = tx.account_id === accountId || tx.paymentMethod === accountName;
    if (!match) return;
    const txDate = tx.date;
    const amt = typeof tx.twdAmount === 'number' ? Math.abs(tx.twdAmount) : 0;
    if (!hasPaid && txDate >= prevBillingDate && txDate <= lastBillingEndDate) totalUsed += amt;
    if (txDate >= lastBillingDate && txDate <= todayDate) totalUsed += amt;
  });
  return totalUsed;
}
