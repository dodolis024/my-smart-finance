// 訂閱扣款日的純日期函式。前端兩處共用：訂閱列表顯示「下次扣款日」（nextChargeDate），
// 新增訂閱時判斷「今天就是扣款日、要立刻入帳」（taipeiClock + chargeDateToday）。
// 後者與排程端 supabase/functions/process-subscriptions/schedule.ts 的同名函式語意相同，
// 兩端必須對「今天該不該扣」給出一樣的答案，否則最壞情況是兩邊都不入帳。
// 規則：扣款日超過當月天數時改在月底扣（31 號遇到 4 月就是 4/30），不跳過。

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const pad2 = (n) => String(n).padStart(2, '0');

export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function clampedDate(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(Math.min(day, daysInMonth(year, month)))}`;
}

/**
 * 以台灣時間（UTC+8）拆出「現在」的年月日與時分。
 * 「今天是不是扣款日」兩端都用台灣時間判斷，裝置時區不同時答案才會一致。
 */
export function taipeiClock(now = new Date()) {
  const tw = new Date(now.getTime() + TAIPEI_OFFSET_MS);
  return {
    year: tw.getUTCFullYear(),
    month: tw.getUTCMonth() + 1,
    day: tw.getUTCDate(),
    time: `${pad2(tw.getUTCHours())}:${pad2(tw.getUTCMinutes())}`,
  };
}

/**
 * 訂閱今天該不該扣款：該扣就回傳交易日期（YYYY-MM-DD），不該扣回傳 null。
 * 年繳只在 renewal_month 那個月扣；扣款日超過當月天數改在月底扣。
 */
export function chargeDateToday(sub, clock) {
  const { year, month, day } = clock;
  if ((sub.billing_cycle || 'monthly') === 'yearly' && Number(sub.renewal_month) !== month) return null;
  const actualDay = Math.min(Number(sub.renewal_day), daysInMonth(year, month));
  if (actualDay !== day) return null;
  return `${year}-${pad2(month)}-${pad2(actualDay)}`;
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
