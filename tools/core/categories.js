import { getAuthedClient } from './client.js';
import { ErrorCode, fromSupabaseError, smfError } from './errors.js';

// 與 src/lib/supabase.js 的 createDefaultData 一致：使用者從未改過分類時 settings 表可能沒有資料
const DEFAULT_EXPENSE = ['飲食', '飲料', '交通', '旅遊', '娛樂', '購物', '其他'];
const DEFAULT_INCOME = ['薪水', '投資', '其他'];

/** settings 表的 value 是 JSONB，直接存字串陣列（不是物件包一層），順序即顯示順序 */
export async function listCategories() {
  const client = await getAuthedClient();
  const { data, error } = await client
    .from('settings')
    .select('key, value')
    .in('key', ['expense_categories', 'income_categories']);

  if (error) throw fromSupabaseError(error, '讀取分類');

  const byKey = Object.fromEntries((data || []).map((row) => [row.key, row.value]));
  const expense = Array.isArray(byKey.expense_categories) ? byKey.expense_categories : DEFAULT_EXPENSE;
  const income = Array.isArray(byKey.income_categories) ? byKey.income_categories : DEFAULT_INCOME;

  return { expense, income };
}

/**
 * 解析分類名稱，決定這筆是支出還是收入。
 *
 * 前端是用 "expense:飲食" 這種前綴字串從下拉選單傳進來的，命令列和 agent 只會給純名稱，
 * 所以要自己判斷歸屬。注意「其他」預設同時存在於支出與收入清單——遇到這種兩邊都有的分類，
 * 這裡要求呼叫端明確指定 type，而不是像前端 fallback 那樣猜（前端會猜成 income）。
 * 記一筆帳時本來就知道是收入還支出，強制講清楚不算負擔，猜錯卻會讓月報表整個歪掉。
 */
export async function resolveCategory(categoryName, explicitType = null) {
  const trimmed = String(categoryName || '').trim();
  if (!trimmed) {
    throw smfError(ErrorCode.INVALID_INPUT, '必須指定分類');
  }

  const { expense, income } = await listCategories();

  if (explicitType) {
    if (explicitType !== 'expense' && explicitType !== 'income') {
      throw smfError(ErrorCode.INVALID_INPUT, 'type 只能是 expense 或 income');
    }
    const pool = explicitType === 'income' ? income : expense;
    if (!pool.includes(trimmed)) {
      throw smfError(
        ErrorCode.CATEGORY_NOT_FOUND,
        `「${trimmed}」不是有效的${explicitType === 'income' ? '收入' : '支出'}分類`,
        `可用的${explicitType === 'income' ? '收入' : '支出'}分類：${pool.join('、')}`
      );
    }
    return { type: explicitType, category: trimmed };
  }

  const inExpense = expense.includes(trimmed);
  const inIncome = income.includes(trimmed);

  if (inExpense && inIncome) {
    throw smfError(
      ErrorCode.INVALID_INPUT,
      `「${trimmed}」同時是支出與收入分類，無法判斷`,
      '請一併指定 type 為 expense 或 income'
    );
  }
  if (inExpense) return { type: 'expense', category: trimmed };
  if (inIncome) return { type: 'income', category: trimmed };

  throw smfError(
    ErrorCode.CATEGORY_NOT_FOUND,
    `找不到分類「${trimmed}」`,
    `可用的支出分類：${expense.join('、')}；收入分類：${income.join('、')}。分類需先在網頁設定中建立，這裡不會自動新增。`
  );
}
