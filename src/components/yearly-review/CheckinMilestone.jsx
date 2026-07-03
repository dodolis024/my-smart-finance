import { useLanguage } from '@/contexts/LanguageContext';

export default function CheckinMilestone({ highlights, loading }) {
  const { t } = useLanguage();
  const days = highlights?.checkinDays ?? 0;

  const encouragement = days >= 200
    ? t('yearlyReview.checkin.encourageHigh')
    : days >= 60
    ? t('yearlyReview.checkin.encourageMid')
    : t('yearlyReview.checkin.encourageLow');

  if (loading) {
    return (
      <div className="review-card review-card--checkin">
        <p className="review-card__loading">{t('yearlyReview.loading')}</p>
      </div>
    );
  }

  return (
    <div className="review-card review-card--checkin">
      <p className="review-card__eyebrow">{t('yearlyReview.checkin.title')}</p>

      <div className="review-checkin-circle">
        <span className="review-checkin-circle__number">{days}</span>
        <span className="review-checkin-circle__unit">{t('yearlyReview.checkin.daysLabel')}</span>
      </div>

      <p className="review-encourage">{encouragement}</p>
    </div>
  );
}
