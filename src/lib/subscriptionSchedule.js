// 訂閱「下次實際扣款日」。只拿來顯示；真正建立交易的日期由 process-subscriptions 排程
// 與 useSubscriptions 在扣款當天各自算（supabase/functions/process-subscriptions/schedule.ts）。
// 規則與那邊一致：扣款日超過當月天數時改在月底扣（31 號遇到 4 月就是 4/30），不跳過。

const pad2 = (n) => String(n).padStart(2, '0');

export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function clampedDate(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(Math.min(day, daysInMonth(year, month)))}`;
}

/**
 * @param {{ billing_cycle?: string|null, renewal_day: number, renewal_month?: number|null }} sub
 * @param {string} todayYmd 今天（YYYY-MM-DD，呼叫端決定用哪個時鐘）
 * @returns {string|null} 下次扣款日（含今天）；年繳缺月份或扣款日無效時回 null
 */
export function nextChargeDate(sub, todayYmd) {
  const day = Number(sub?.renewal_day);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  const [y, m] = String(todayYmd).split('-').map(Number);
  if (!y || !m) return null;

  if ((sub.billing_cycle || 'monthly') === 'yearly') {
    const month = Number(sub.renewal_month);
    if (!Number.isInteger(month) || month < 1 || month > 12) return null;
    const thisYear = clampedDate(y, month, day);
    return thisYear >= todayYmd ? thisYear : clampedDate(y + 1, month, day);
  }

  const thisMonth = clampedDate(y, m, day);
  if (thisMonth >= todayYmd) return thisMonth;
  return m === 12 ? clampedDate(y + 1, 1, day) : clampedDate(y, m + 1, day);
}
