import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { isYearlyReviewAnnounceWindow } from '@/lib/utils';

export default function YearlyReviewBanner() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const now = new Date();
  const reviewYear = now.getFullYear() - 1;

  if (!isYearlyReviewAnnounceWindow(now)) return null;

  return (
    <button
      className="yearly-review-banner"
      onClick={() => navigate(`/yearly-review?year=${reviewYear}`)}
      aria-label={t('yearlyReview.bannerTitle')}
    >
      <span className="yearly-review-banner__icon" aria-hidden="true">✦</span>
      <div className="yearly-review-banner__text">
        <div className="yearly-review-banner__title">{t('yearlyReview.bannerTitle')}</div>
        <div className="yearly-review-banner__sub">
          {t('yearlyReview.bannerSubtitle').replace('{year}', reviewYear)}
        </div>
      </div>
      <span className="yearly-review-banner__cta">{t('yearlyReview.bannerCta')} →</span>
    </button>
  );
}
