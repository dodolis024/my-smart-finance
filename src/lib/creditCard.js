/**
 * 信用卡帳單週期與使用額度計算
 */

const pad = (n) => String(n).padStart(2, '0');

// 帳單日 29–31 遇到小月時，夾在該月實際天數內（例如 2 月的帳單日 31 → 2/28），
// 避免組出 2026-02-31 這種不存在的日期
function fmtClamped(year, month, day) {
  const daysInMonth = new Date(year, month, 0).getDate();
  return `${year}-${pad(month)}-${pad(Math.min(day, daysInMonth))}`;
}

/**
 * 計算信用卡目前的帳單週期邊界（皆為 YYYY-MM-DD 字串）。
 * 回傳 null 表示帳戶沒有設定帳單日。
 *
 * - prevBillingDate:    上一期帳單起始日
 * - lastBillingDate:    本期帳單起始日
 * - lastBillingEndDate: 上一期帳單截止日（本期起始日的前一天）
 * - todayDate:          今天
 */
export function getBillingCycleRange(account, today = new Date()) {
  const billingDay = account.billing_day || account.billingDay;
  if (!billingDay) return null;

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

  const lastBillingDayClamped = Math.min(
    billingDay,
    new Date(lastBillingYear, lastBillingMonth, 0).getDate()
  );
  // 本期起始日的前一天；day 為 0 時 Date 會自動回推到上個月最後一天
  const endDate = new Date(lastBillingYear, lastBillingMonth - 1, lastBillingDayClamped - 1);

  return {
    prevBillingDate: fmtClamped(prevBillingYear, prevBillingMonth, billingDay),
    lastBillingDate: fmtClamped(lastBillingYear, lastBillingMonth, billingDay),
    lastBillingEndDate: `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}`,
    todayDate: fmtClamped(currentYear, currentMonth, currentDay),
  };
}

export function calculateCreditUsage(account, history) {
  const paymentDueDay = account.payment_due_day || account.paymentDueDay;
  const billingDay = account.billing_day || account.billingDay;
  const accountId = account.id;
  const accountName = account.name || account.accountName;

  const cycle = getBillingCycleRange(account);
  if (!cycle) return 0;
  const { prevBillingDate, lastBillingDate, lastBillingEndDate, todayDate } = cycle;

  const currentDay = new Date().getDate();

  let hasPaid = false;
  if (paymentDueDay) {
    if (paymentDueDay > billingDay) {
      if (currentDay >= billingDay && currentDay >= paymentDueDay) hasPaid = true;
    } else {
      if (currentDay < billingDay && currentDay >= paymentDueDay) hasPaid = true;
    }
  }

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
