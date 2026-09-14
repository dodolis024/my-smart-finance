import { useLanguage } from '@/contexts/LanguageContext';
import { useDisplayAmount } from '@/contexts/DisplayAmountContext';

/** summary 的 *Estimated：該數字裡有任何一筆以今日匯率估算（只在顯示幣別不是台幣時出現） */
export default function StatCards({ summary }) {
  const { t } = useLanguage();
  const { formatTotal } = useDisplayAmount();
  const incomeEstimated = Boolean(summary.incomeEstimated);
  const expenseEstimated = Boolean(summary.expenseEstimated);
  const balanceEstimated = incomeEstimated || expenseEstimated;
  const hint = (estimated) => (estimated ? t('dashboard.estimatedTotalHint') : undefined);
  const balanceClass = Math.round(summary.balance) >= 0 ? 'balance-positive' : 'balance-negative';

  return (
    <div className="stats-cards">
      <div className="stat-card">
        <span className="stat-label">{t('dashboard.income')}</span>
        <span className="stat-value" title={hint(incomeEstimated)}>
          {formatTotal(summary.totalIncome)}
        </span>
      </div>
      <div className="stat-card">
        <span className="stat-label">{t('dashboard.expense')}</span>
        <span className="stat-value" title={hint(expenseEstimated)}>
          {formatTotal(summary.totalExpense)}
        </span>
      </div>
      <div className="stat-card">
        <span className="stat-label">{t('dashboard.balance')}</span>
        <span className={`stat-value ${balanceClass}`} title={hint(balanceEstimated)}>
          {formatTotal(summary.balance)}
        </span>
      </div>
    </div>
  );
}
