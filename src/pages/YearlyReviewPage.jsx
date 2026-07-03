import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useYearlyReview } from '@/hooks/useYearlyReview';
import { useLanguage } from '@/contexts/LanguageContext';
import StoryProgressBar from '@/components/yearly-review/StoryProgressBar';
import ReviewCover from '@/components/yearly-review/ReviewCover';
import AnnualTotals from '@/components/yearly-review/AnnualTotals';
import MonthlyBarChart from '@/components/yearly-review/MonthlyBarChart';
import TopCategory from '@/components/yearly-review/TopCategory';
import TopExpenses from '@/components/yearly-review/TopExpenses';
import MonthHighlights from '@/components/yearly-review/MonthHighlights';
import HabitJourney from '@/components/yearly-review/HabitJourney';
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

  const { loading, error, annualTotals, monthlyBreakdown, topCategories, topExpenses, highlights } = useYearlyReview(year);

  const handleClose = useCallback(() => navigate('/'), [navigate]);

  // Each card renders from its own index, so `active`-driven animations stay
  // correct no matter how the order changes.
  const cardDefs = [
    { key: 'cover', render: () => (
      <ReviewCover year={year} onYearChange={(y) => { setYear(y); setCurrentIndex(0); }} />
    ) },
    { key: 'totals', render: (active) => (
      <AnnualTotals data={annualTotals} loading={loading} active={active} />
    ) },
    { key: 'chart', render: () => (
      <MonthlyBarChart data={monthlyBreakdown} loading={loading} />
    ) },
    { key: 'category', render: () => (
      <TopCategory
        data={topCategories}
        loading={loading}
        expenseCount={annualTotals?.expenseCount}
        totalExpense={annualTotals?.totalExpense}
      />
    ) },
    { key: 'expenses', render: () => (
      <TopExpenses data={topExpenses} loading={loading} />
    ) },
    { key: 'months', render: () => (
      <MonthHighlights data={monthlyBreakdown} loading={loading} />
    ) },
    { key: 'habit', render: () => (
      <HabitJourney
        year={year}
        checkinDays={highlights?.checkinDays ?? 0}
        transactionCount={annualTotals?.transactionCount ?? 0}
        loading={loading}
      />
    ) },
    { key: 'closing', render: () => (
      <ReviewClosing year={year} onClose={handleClose} />
    ) },
  ];

  const total = cardDefs.length;
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
          {cardDefs.map((card, i) => (
            <div key={card.key} className="yearly-review__card-slot">
              {card.render(i === currentIndex)}
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
