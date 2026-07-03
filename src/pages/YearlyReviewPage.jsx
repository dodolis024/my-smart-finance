import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useYearlyReview } from '@/hooks/useYearlyReview';
import { useLanguage } from '@/contexts/LanguageContext';
import StoryProgressBar from '@/components/yearly-review/StoryProgressBar';
import ReviewCover from '@/components/yearly-review/ReviewCover';
import MembershipDays from '@/components/yearly-review/MembershipDays';
import AnnualTotals from '@/components/yearly-review/AnnualTotals';
import MonthlyBarChart from '@/components/yearly-review/MonthlyBarChart';
import TopCategory from '@/components/yearly-review/TopCategory';
import MonthHighlights from '@/components/yearly-review/MonthHighlights';
import CheckinMilestone from '@/components/yearly-review/CheckinMilestone';
import ReviewClosing from '@/components/yearly-review/ReviewClosing';
import '@/styles/yearly-review.css';

function defaultYear() {
  const now = new Date();
  return now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
}

export default function YearlyReviewPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [year, setYear] = useState(() => {
    const fromUrl = parseInt(searchParams.get('year'), 10);
    return Number.isFinite(fromUrl) ? fromUrl : defaultYear();
  });

  const { loading, error, annualTotals, monthlyBreakdown, topCategories, highlights } = useYearlyReview(year);

  const handleClose = useCallback(() => navigate('/'), [navigate]);

  const cards = [
    <ReviewCover key="cover" year={year} onYearChange={(y) => { setYear(y); setCurrentIndex(0); }} />,
    <MembershipDays key="membership" loading={loading} />,
    <AnnualTotals key="totals" data={annualTotals} loading={loading} active={currentIndex === 2} />,
    <MonthlyBarChart key="chart" data={monthlyBreakdown} loading={loading} />,
    <TopCategory
      key="category"
      data={topCategories}
      loading={loading}
      expenseCount={annualTotals?.expenseCount}
      totalExpense={annualTotals?.totalExpense}
    />,
    <MonthHighlights key="months" highlights={highlights} loading={loading} />,
    <CheckinMilestone key="checkin" highlights={highlights} loading={loading} />,
    <ReviewClosing key="closing" year={year} onClose={handleClose} />,
  ];

  const total = cards.length;
  const goTo = useCallback((i) => setCurrentIndex(Math.max(0, Math.min(i, total - 1))), [total]);
  const prev = useCallback(() => goTo(currentIndex - 1), [currentIndex, goTo]);
  const next = useCallback(() => goTo(currentIndex + 1), [currentIndex, goTo]);

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowLeft')  prev();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, handleClose]);

  // Touch swipe
  const touchStartX = useRef(null);
  const onTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchStartX.current === null) return;
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) diff > 0 ? next() : prev();
    touchStartX.current = null;
  };

  if (!loading && error) {
    return (
      <div className="yearly-review" role="dialog" aria-modal="true" aria-label={t('yearlyReview.bannerTitle')}>
        <div className="yearly-review__header">
          <div style={{ flex: 1 }} />
          <button className="yearly-review__close" onClick={handleClose} aria-label={t('yearlyReview.close')}>✕</button>
        </div>
        <div className="review-card review-card--cover">
          <p className="review-card__title">{t('yearlyReview.loadError')}</p>
          <p className="review-card__empty">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="yearly-review"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      role="dialog"
      aria-modal="true"
      aria-label={t('yearlyReview.bannerTitle')}
    >
      <div className="yearly-review__header">
        <StoryProgressBar total={total} current={currentIndex} onJump={goTo} />
        <button className="yearly-review__close" onClick={handleClose} aria-label={t('yearlyReview.close')}>✕</button>
      </div>

      <div className="yearly-review__viewport">
        <div
          className="yearly-review__track"
          style={{ transform: `translateX(-${currentIndex * 100}vw)` }}
        >
          {cards.map((card, i) => (
            <div key={i} className="yearly-review__card-slot">
              {card}
            </div>
          ))}
        </div>
      </div>

      {currentIndex > 0 && (
        <button
          className="yearly-review__nav yearly-review__nav--prev"
          onClick={prev}
          aria-label="上一張"
        >
          ‹
        </button>
      )}
      {currentIndex < total - 1 && (
        <button
          className="yearly-review__nav yearly-review__nav--next"
          onClick={next}
          aria-label="下一張"
        >
          ›
        </button>
      )}
    </div>
  );
}
