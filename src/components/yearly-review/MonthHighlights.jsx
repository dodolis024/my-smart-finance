import { useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatMoneyInteger } from '@/lib/utils';
import zh from '@/locales/zh';
import en from '@/locales/en';

export default function MonthHighlights({ data = [], loading }) {
  const { t, lang } = useLanguage();
  const monthNames = (lang === 'en' ? en : zh).yearlyReview.monthlyChart.months;

  // Only months with any activity count — an empty month's balance of 0
  // shouldn't masquerade as "best saving".
  const { best, worst } = useMemo(() => {
    const active = data.filter((d) => (d?.income ?? 0) > 0 || (d?.expense ?? 0) > 0);
    if (active.length === 0) return { best: null, worst: null };
    let best = active[0];
    let worst = active[0];
    for (const m of active) {
      if (m.balance > best.balance) best = m;
      if (m.balance < worst.balance) worst = m;
    }
    return { best, worst };
  }, [data]);

  if (loading) {
    return (
      <div className="review-card review-card--month-highlights">
        <p className="review-card__loading">{t('yearlyReview.loading')}</p>
      </div>
    );
  }

  if (!best && !worst) {
    return (
      <div className="review-card review-card--month-highlights">
        <p className="review-card__title">{t('yearlyReview.monthHighlights.title')}</p>
        <p className="review-card__empty">{t('yearlyReview.monthHighlights.noData')}</p>
      </div>
    );
  }

  const monthLabel = (m) => monthNames[m - 1] ?? m;
  // With only one active month best === worst; showing it once avoids a
  // duplicated pair.
  const sameMonth = best && worst && best.month === worst.month;

  return (
    <div className="review-card review-card--month-highlights">
      <p className="review-card__eyebrow">{t('yearlyReview.monthHighlights.title')}</p>

      <div className="review-highlight-pair">
        {best && (
          <div className="review-highlight-box review-highlight-box--low">
            <span className="review-highlight-box__label">{t('yearlyReview.monthHighlights.bestSaving')}</span>
            <span className="review-highlight-box__month">{monthLabel(best.month)}</span>
            <span className="review-highlight-box__amount">
              {t('yearlyReview.monthHighlights.netLabel', { amount: formatMoneyInteger(best.balance) })}
            </span>
          </div>
        )}
        {worst && !sameMonth && (
          <div className="review-highlight-box review-highlight-box--high">
            <span className="review-highlight-box__label">{t('yearlyReview.monthHighlights.mostOverspent')}</span>
            <span className="review-highlight-box__month">{monthLabel(worst.month)}</span>
            <span className="review-highlight-box__amount">
              {t('yearlyReview.monthHighlights.netLabel', { amount: formatMoneyInteger(worst.balance) })}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
