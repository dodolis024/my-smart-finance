import { formatMoney } from '@/lib/utils';

export default function StatCards({ summary }) {
  const balance = Math.round(summary.balance);
  const balanceClass = balance >= 0 ? 'balance-positive' : 'balance-negative';

  return (
    <div className="stats-cards">
      <div className="stat-card">
        <span className="stat-label">收入</span>
        <span className="stat-value">
          {formatMoney(Math.round(summary.totalIncome))}
        </span>
      </div>
      <div className="stat-card">
        <span className="stat-label">支出</span>
        <span className="stat-value">
          {formatMoney(Math.round(summary.totalExpense))}
        </span>
      </div>
      <div className="stat-card">
        <span className="stat-label">餘額</span>
        <span className={`stat-value ${balanceClass}`}>
          {formatMoney(balance)}
        </span>
      </div>
    </div>
  );
}
