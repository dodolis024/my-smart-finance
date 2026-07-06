import { useLanguage } from '@/contexts/LanguageContext';
import ReviewExportFooter from './ReviewExportFooter';

export default function ReviewCover({ year, onYearChange, forExport = false }) {
  const { t } = useLanguage();
  const currentYear = new Date().getFullYear();

  return (
    <div className="review-card review-card--cover">
      <p className="review-card__eyebrow">✦ Smart Finance</p>

      {!forExport && (
        <div className="review-year-selector">
          <button
            className="review-year-selector__btn"
            onClick={() => onYearChange(year - 1)}
            aria-label={t('yearlyReview.prevYear')}
          >
            ‹
          </button>
          <span className="review-year-selector__year">{year}</span>
          <button
            className="review-year-selector__btn"
            onClick={() => onYearChange(Math.min(year + 1, currentYear))}
            aria-label={t('yearlyReview.nextYear')}
            disabled={year >= currentYear}
            style={{ opacity: year >= currentYear ? 0.3 : 1 }}
          >
            ›
          </button>
        </div>
      )}

      {forExport && (
        <p className="review-year-selector__year" style={{ fontSize: '1.5rem', fontWeight: 900, marginBottom: 40 }}>
          {year}
        </p>
      )}

      <h1 className="review-card__title">
        {t('yearlyReview.cover.title').replace('{year}', year)}
      </h1>
      <p className="review-card__subtitle">{t('yearlyReview.cover.subtitle')}</p>

      {!forExport && <p className="review-card__hint">{t('yearlyReview.cover.tapHint')}</p>}
      {forExport && <ReviewExportFooter year={year} />}
    </div>
  );
}
