import { useLanguage } from '@/contexts/LanguageContext';

export default function ReviewClosing({ year, onClose }) {
  const { t } = useLanguage();

  return (
    <div className="review-card review-card--closing">
      <p className="review-card__eyebrow">✦ {year}</p>
      <h2 className="review-card__title">{t('yearlyReview.closing.title')}</h2>
      <p className="review-card__subtitle">
        {t('yearlyReview.closing.subtitle').replace('{year}', year)}
      </p>
      <button className="review-closing-back" onClick={onClose}>
        {t('yearlyReview.closing.backBtn')}
      </button>
    </div>
  );
}
