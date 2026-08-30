import { listAccounts } from '../../core/accounts.js';
import { listCategories } from '../../core/categories.js';
import { getMonthlySummary, getStreak, getYearlyReview } from '../../core/stats.js';
import { money, printJson, table } from '../format.js';

const ACCOUNT_TYPE_LABELS = {
  cash: '現金',
  credit_card: '信用卡',
  debit_card: '簽帳金融卡',
  digital_wallet: '電子錢包',
  bank: '銀行帳戶',
};

export async function accountsCommand({ flags = {} } = {}) {
  const accounts = await listAccounts();

  if (flags.json) return printJson(accounts);

  console.log(
    table(
      accounts.map((a) => ({
        name: a.name,
        type: ACCOUNT_TYPE_LABELS[a.type] || a.type,
        limit: a.credit_limit ? `NT$${money(a.credit_limit)}` : '－',
        billing: a.billing_day ? `每月 ${a.billing_day} 日` : '－',
      })),
      [
        { key: 'name', label: '帳戶名稱' },
        { key: 'type', label: '類型' },
        { key: 'limit', label: '額度', align: 'right' },
        { key: 'billing', label: '結帳日' },
      ]
    )
  );
}

export async function categoriesCommand({ flags = {} } = {}) {
  const categories = await listCategories();

  if (flags.json) return printJson(categories);

  const { expense, income } = categories;
  console.log(`支出分類：${expense.join('、')}`);
  console.log(`收入分類：${income.join('、')}`);
}

export async function summaryCommand({ flags }) {
  const result = await getMonthlySummary({ year: flags.year, month: flags.month });

  if (flags.json) return printJson(result);

  const { summary } = result;

  console.log(`${result.year} 年 ${result.month} 月（共 ${result.transactionCount} 筆）`);
  console.log(`  收入  NT$${money(summary.totalIncome)}`);
  console.log(`  支出  NT$${money(summary.totalExpense)}`);
  console.log(`  結餘  NT$${money(summary.balance)}`);

  if (result.expenseByCategory.length > 0) {
    console.log('\n支出分類排行');
    console.log(
      table(
        result.expenseByCategory.map((row) => ({
          category: row.category,
          total: `NT$${money(row.total)}`,
        })),
        [
          { key: 'category', label: '分類' },
          { key: 'total', label: '金額', align: 'right' },
        ]
      )
    );
  }
}

export async function streakCommand({ flags = {} } = {}) {
  const streak = await getStreak();

  if (flags.json) return printJson(streak);

  console.log(`連續記帳  ${streak.streakCount} 天${streak.streakBroken ? '（已中斷）' : ''}`);
  console.log(`最長紀錄  ${streak.longestStreak} 天`);
  console.log(`累計天數  ${streak.totalLoggedDays} 天`);
}

export async function yearCommand({ positional }) {
  // 年度回顧的結構本來就複雜，一律以 JSON 呈現
  printJson(await getYearlyReview(positional[0]));
}
