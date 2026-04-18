import { formatMoney } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';

export default function StatCards({ summary }) {
  const { t } = useLanguage();
  const balance = Math.round(summary.balance);
  const balanceClass = balance >= 0 ? 'balance-positive' : 'balance-negative';

  return (
    <div className="stats-cards">
      <div className="stat-card">
        <span className="stat-label">{t('dashboard.income')}</span>
        <span className="stat-value">
          {formatMoney(Math.round(summary.totalIncome))}
        </span>
      </div>
      <div className="stat-card">
        <span className="stat-label">{t('dashboard.expense')}</span>
        <span className="stat-value">
          {formatMoney(Math.round(summary.totalExpense))}
        </span>
      </div>
      <div className="stat-card">
        <span className="stat-label">{t('dashboard.balance')}</span>
        <span className={`stat-value ${balanceClass}`}>
          {formatMoney(balance)}
        </span>
      </div>
    </div>
  );
}
