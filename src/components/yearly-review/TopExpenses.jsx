import { useLanguage } from '@/contexts/LanguageContext';
import { formatMoneyInteger } from '@/lib/utils';
import zh from '@/locales/zh';
import en from '@/locales/en';

export default function TopExpenses({ data = [], loading }) {
  const { t, lang } = useLanguage();
  const monthNames = (lang === 'en' ? en : zh).yearlyReview.monthlyChart.months;

  if (loading) {
    return (
      <div className="review-card review-card--top-expenses">
        <p className="review-card__loading">{t('yearlyReview.loading')}</p>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="review-card review-card--top-expenses">
        <p className="review-card__title">{t('yearlyReview.topExpenses.title')}</p>
        <p className="review-card__empty">{t('yearlyReview.topExpenses.noData')}</p>
      </div>
    );
  }

  // Parse the plain YYYY-MM-DD directly — `new Date(str)` treats it as UTC and
  // can shift the day by one in some timezones.
  const formatDate = (dateStr) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr || '');
    if (!m) return '';
    return t('yearlyReview.topExpenses.dateLabel', {
      month: monthNames[parseInt(m[2], 10) - 1],
      day: parseInt(m[3], 10),
    });
  };

  return (
    <div className="review-card review-card--top-expenses">
      <p className="review-card__eyebrow">{t('yearlyReview.topExpenses.title')}</p>

      <ol className="review-top-expenses">
        {data.map((item, i) => (
          <li key={i} className="review-expense-row">
            <span className="review-expense-row__rank">{i + 1}</span>
            <div className="review-expense-row__body">
              <span className="review-expense-row__name">
                {item.itemName || t('yearlyReview.topExpenses.untitled')}
              </span>
              <span className="review-expense-row__meta">
                {item.category} · {formatDate(item.date)}
              </span>
            </div>
            <span className="review-expense-row__amount">
              {formatMoneyInteger(item.amount)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
