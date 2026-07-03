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

export default function AnnualTotals({ data, loading, active }) {
  const { t } = useLanguage();

  const income  = useCountUp(data?.totalIncome  ?? 0, 1200, active && !loading);
  const expense = useCountUp(data?.totalExpense ?? 0, 1200, active && !loading);
  const balance = useCountUp(Math.abs(data?.balance ?? 0), 1200, active && !loading);
  const isPositive = (data?.balance ?? 0) >= 0;

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
        </div>
        <div className="review-stat-item">
          <span className="review-stat-item__label">{t('yearlyReview.totals.expense')}</span>
          <span className="review-stat-item__value review-stat-item__value--expense review-count-up">
            {formatMoneyInteger(expense)}
          </span>
        </div>
        <div className="review-stat-item">
          <span className="review-stat-item__label">{t('yearlyReview.totals.balance')}</span>
          <span className={`review-stat-item__value review-count-up ${isPositive ? 'review-stat-item__value--positive' : 'review-stat-item__value--negative'}`}>
            {isPositive ? '' : '-'}{formatMoneyInteger(balance)}
          </span>
        </div>
      </div>

      <div className="review-result-tag">
        {isPositive ? t('yearlyReview.totals.surplus') : t('yearlyReview.totals.deficit')}
      </div>
    </div>
  );
}
