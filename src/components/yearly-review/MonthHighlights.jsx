import { useLanguage } from '@/contexts/LanguageContext';
import { formatMoneyInteger } from '@/lib/utils';
import zh from '@/locales/zh';
import en from '@/locales/en';

export default function MonthHighlights({ highlights, loading }) {
  const { t, lang } = useLanguage();
  const monthNames = (lang === 'en' ? en : zh).yearlyReview.monthlyChart.months;

  if (loading) {
    return (
      <div className="review-card review-card--month-highlights">
        <p className="review-card__loading">{t('yearlyReview.loading')}</p>
      </div>
    );
  }

  const high = highlights?.highestMonth;
  const low  = highlights?.lowestMonth;

  if (!high && !low) {
    return (
      <div className="review-card review-card--month-highlights">
        <p className="review-card__title">{t('yearlyReview.monthHighlights.title')}</p>
        <p className="review-card__empty">{t('yearlyReview.monthHighlights.noData')}</p>
      </div>
    );
  }

  const monthLabel = (m) => monthNames[m - 1] ?? m;

  return (
    <div className="review-card review-card--month-highlights">
      <p className="review-card__eyebrow">{t('yearlyReview.monthHighlights.title')}</p>

      <div className="review-highlight-pair">
        {high && (
          <div className="review-highlight-box review-highlight-box--high">
            <span className="review-highlight-box__label">{t('yearlyReview.monthHighlights.highest')}</span>
            <span className="review-highlight-box__month">{monthLabel(high.month)}</span>
            <span className="review-highlight-box__amount">{formatMoneyInteger(high.expense)}</span>
          </div>
        )}
        {low && (
          <div className="review-highlight-box review-highlight-box--low">
            <span className="review-highlight-box__label">{t('yearlyReview.monthHighlights.lowest')}</span>
            <span className="review-highlight-box__month">{monthLabel(low.month)}</span>
            <span className="review-highlight-box__amount">{formatMoneyInteger(low.expense)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
