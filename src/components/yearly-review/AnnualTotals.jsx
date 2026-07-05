import { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatMoneyInteger } from '@/lib/utils';

function useCountUp(target, duration = 1200, active = true) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active || !target) { setValue(target || 0); return; }
    let startTime = null;
    const animate = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [target, active, duration]);
  return value;
}

// Percentage change chip for magnitude metrics (income / expense). Hidden when
// there's no comparable prior value. `upIsGood` sets the semantic color: a drop
// in expense is good (green), a drop in income is bad (red).
function pctChip(cur, prev, upIsGood, prevYear, t) {
  if (!prev) return null;
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  if (pct === 0) return null;
  const up = pct > 0;
  return {
    good: up === upIsGood,
    text: `${up ? '▲' : '▼'} ${Math.abs(pct)}% ${t('yearlyReview.compare.vsYear', { year: prevYear })}`,
  };
}

// Balance is compared by absolute difference — a percentage across sign flips
// (e.g. −$1k → +$500) would be meaningless. More balance than last year is good.
function amountChip(cur, prev, prevYear, t) {
  const diff = cur - prev;
  if (diff === 0) return null;
  const up = diff > 0;
  return {
    good: up,
    text: `${up ? '▲' : '▼'} ${formatMoneyInteger(Math.abs(diff))} ${t('yearlyReview.compare.vsYear', { year: prevYear })}`,
  };
}

function DeltaChip({ chip }) {
  if (!chip) return null;
  return (
    <span className={`review-delta ${chip.good ? 'review-delta--good' : 'review-delta--bad'}`}>
      {chip.text}
    </span>
  );
}

export default function AnnualTotals({ data, previous, year, loading, active }) {
  const { t } = useLanguage();

  const income  = useCountUp(data?.totalIncome  ?? 0, 1200, active && !loading);
  const expense = useCountUp(data?.totalExpense ?? 0, 1200, active && !loading);
  const balance = useCountUp(Math.abs(data?.balance ?? 0), 1200, active && !loading);
  const isPositive = (data?.balance ?? 0) >= 0;

  // Only compare when last year actually had records.
  const prev = previous && previous.transactionCount > 0 ? previous : null;
  const prevYear = (year ?? new Date().getFullYear()) - 1;
  const incomeChip  = prev ? pctChip(data?.totalIncome ?? 0, prev.totalIncome, true, prevYear, t) : null;
  const expenseChip = prev ? pctChip(data?.totalExpense ?? 0, prev.totalExpense, false, prevYear, t) : null;
  const balanceChip = prev ? amountChip(data?.balance ?? 0, prev.balance, prevYear, t) : null;

  if (loading) {
    return (
      <div className="review-card review-card--totals">
        <p className="review-card__loading">{t('yearlyReview.loading')}</p>
      </div>
    );
  }

  return (
    <div className="review-card review-card--totals">
      <p className="review-card__eyebrow">{t('yearlyReview.totals.title')}</p>

      <div className="review-stat-grid">
        <div className="review-stat-item">
          <span className="review-stat-item__label">{t('yearlyReview.totals.income')}</span>
          <span className="review-stat-item__value review-stat-item__value--income review-count-up">
            {formatMoneyInteger(income)}
          </span>
          <DeltaChip chip={incomeChip} />
        </div>
        <div className="review-stat-item">
          <span className="review-stat-item__label">{t('yearlyReview.totals.expense')}</span>
          <span className="review-stat-item__value review-stat-item__value--expense review-count-up">
            {formatMoneyInteger(expense)}
          </span>
          <DeltaChip chip={expenseChip} />
        </div>
        <div className="review-stat-item">
          <span className="review-stat-item__label">{t('yearlyReview.totals.balance')}</span>
          <span className={`review-stat-item__value review-count-up ${isPositive ? 'review-stat-item__value--positive' : 'review-stat-item__value--negative'}`}>
            {isPositive ? '' : '-'}{formatMoneyInteger(balance)}
          </span>
          <DeltaChip chip={balanceChip} />
        </div>
      </div>

      {(data?.transactionCount ?? 0) > 0 && (
        <div className="review-result-tag">
          {isPositive ? t('yearlyReview.totals.surplus') : t('yearlyReview.totals.deficit')}
        </div>
      )}
    </div>
  );
}
