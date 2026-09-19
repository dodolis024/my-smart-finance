import { useRef } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDisplayAmount } from '@/contexts/DisplayAmountContext';
import { useFitStatValues } from '@/hooks/useFitStatValues';

export default function StatCards({ summary }) {
  const { t } = useLanguage();
  const { formatTotal } = useDisplayAmount();
  const balanceClass = Math.round(summary.balance) >= 0 ? 'balance-positive' : 'balance-negative';
  const incomeText = formatTotal(summary.totalIncome);
  const expenseText = formatTotal(summary.totalExpense);
  const balanceText = formatTotal(summary.balance);
  const containerRef = useRef(null);
  useFitStatValues(containerRef, `${incomeText}|${expenseText}|${balanceText}`);

  return (
    <div className="stats-cards" ref={containerRef}>
      <div className="stat-card">
        <span className="stat-label">{t('dashboard.income')}</span>
        <span className="stat-value">
          {incomeText}
        </span>
      </div>
      <div className="stat-card">
        <span className="stat-label">{t('dashboard.expense')}</span>
        <span className="stat-value">
          {expenseText}
        </span>
      </div>
      <div className={`stat-card ${balanceClass === 'balance-negative' ? 'is-negative' : ''}`}>
        <span className="stat-label">{t('dashboard.balance')}</span>
        <span className={`stat-value ${balanceClass}`}>
          {balanceText}
        </span>
      </div>
    </div>
  );
}
