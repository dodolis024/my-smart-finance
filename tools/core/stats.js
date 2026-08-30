import { getAuthedClient } from './client.js';
import { getTodayYmd } from './dates.js';
import { ErrorCode, fromSupabaseError, smfError } from './errors.js';

/**
 * 統計一律走資料庫既有的 RPC，不在這裡重寫聚合。
 *
 * 網頁的儀表板與年度回顧用的就是這兩支函式，共用它們才能保證 CLI 報出來的數字
 * 跟使用者在網頁上看到的一模一樣。自己用 JS 重算 SUM 遲早會因為某個邊界條件而對不上。
 */

async function callDashboard(year, month) {
  const client = await getAuthedClient();
  const now = new Date();
  const y = Number(year) || now.getFullYear();
  const m = Number(month) || now.getMonth() + 1;

  if (m < 1 || m > 12) {
    throw smfError(ErrorCode.INVALID_INPUT, `月份必須介於 1 到 12（收到：${m}）`);
  }

  const { data, error } = await client.rpc('get_dashboard_data', {
    p_client_today: getTodayYmd(),
    p_month: m,
    p_year: y,
  });

  if (error) throw fromSupabaseError(error, '讀取統計');
  if (!data?.success) {
    throw smfError(ErrorCode.DB_ERROR, `讀取統計失敗：${data?.error || '未知錯誤'}`);
  }
  return { data, year: y, month: m };
}

/** 依分類彙總；資料來自 RPC 回傳的當月交易，與網頁圖表同一份來源 */
function summarizeByCategory(history, type) {
  const totals = new Map();
  for (const tx of history) {
    if (tx.type !== type) continue;
    const amount = Number(tx.twdAmount ?? tx.twd_amount ?? 0);
    totals.set(tx.category, (totals.get(tx.category) || 0) + amount);
  }
  return [...totals.entries()]
    .map(([category, total]) => ({ category, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => b.total - a.total);
}

export async function getMonthlySummary({ year, month } = {}) {
  const { data, year: y, month: m } = await callDashboard(year, month);
  const history = data.history || [];

  return {
    year: y,
    month: m,
    summary: data.summary || { totalIncome: 0, totalExpense: 0, balance: 0 },
    transactionCount: history.length,
    expenseByCategory: summarizeByCategory(history, 'expense'),
    incomeByCategory: summarizeByCategory(history, 'income'),
  };
}

/** 連續記帳狀態；走 get_dashboard_data 是因為它內部用 auth.uid() 判斷身分 */
export async function getStreak() {
  const { data } = await callDashboard();
  return {
    streakCount: data.streakCount ?? 0,
    streakBroken: Boolean(data.streakBroken),
    totalLoggedDays: data.totalLoggedDays ?? 0,
    longestStreak: data.longestStreak ?? 0,
  };
}

export async function getYearlyReview(year) {
  const client = await getAuthedClient();
  const y = Number(year) || new Date().getFullYear();

  const { data, error } = await client.rpc('get_yearly_review', { p_year: y });

  if (error) throw fromSupabaseError(error, '讀取年度回顧');
  if (!data?.success) {
    throw smfError(ErrorCode.DB_ERROR, `讀取年度回顧失敗：${data?.error || '未知錯誤'}`);
  }
  return data;
}
