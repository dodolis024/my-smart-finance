import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useYearlyReview } from '@/hooks/useYearlyReview';
import { useCardExport } from '@/hooks/useCardExport';
import { useLanguage } from '@/contexts/LanguageContext';
import { isYearLocked } from '@/lib/utils';
import StoryProgressBar from '@/components/yearly-review/StoryProgressBar';
import ReviewCover from '@/components/yearly-review/ReviewCover';
import AnnualTotals from '@/components/yearly-review/AnnualTotals';
import MonthlyTrendChart from '@/components/yearly-review/MonthlyTrendChart';
import TopCategory from '@/components/yearly-review/TopCategory';
import TopExpenses from '@/components/yearly-review/TopExpenses';
import MonthHighlights from '@/components/yearly-review/MonthHighlights';
import HabitJourney from '@/components/yearly-review/HabitJourney';
import ReviewClosing from '@/components/yearly-review/ReviewClosing';
import CardExportStage from '@/components/yearly-review/CardExportStage';
import ShareCardButton from '@/components/yearly-review/ShareCardButton';
import '@/styles/yearly-review.css';
import '@/styles/card-export.css';

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

  const locked = isYearLocked(year);
  const { loading, error, annualTotals, previousTotals, monthlyBreakdown, topCategories, topExpenses, highlights } = useYearlyReview(locked ? null : year);
  const { exporting, stageRef, shareCard } = useCardExport();

  const handleClose = useCallback(() => navigate('/'), [navigate]);
  const goToPreviousYear = useCallback(() => {
    setYear((y) => y - 1);
    setCurrentIndex(0);
  }, []);

  // Each card renders from its own index, so `active`-driven animations stay
  // correct no matter how the order changes.
  // Narrative arc — build to the climax: warm up with habits, walk through the
  // spending details, then land the annual verdict + YoY as the payoff.
  const cardDefs = [
    { key: 'cover', render: (active, forExport) => (
      <ReviewCover
        year={year}
        onYearChange={forExport ? () => {} : (y) => { setYear(y); setCurrentIndex(0); }}
        forExport={forExport}
      />
    ) },
    { key: 'habit', render: (active, forExport) => (
      <HabitJourney
        year={year}
        checkinDays={highlights?.checkinDays ?? 0}
        transactionCount={annualTotals?.transactionCount ?? 0}
        previousCount={previousTotals?.transactionCount ?? 0}
        loading={loading}
        forExport={forExport}
      />
    ) },
    { key: 'chart', render: (active, forExport) => (
      <MonthlyTrendChart data={monthlyBreakdown} loading={loading} forExport={forExport} year={year} />
    ) },
    { key: 'category', render: (active, forExport) => (
      <TopCategory
        data={topCategories}
        loading={loading}
        expenseCount={annualTotals?.expenseCount}
        totalExpense={annualTotals?.totalExpense}
        forExport={forExport}
        year={year}
      />
    ) },
    { key: 'expenses', render: (active, forExport) => (
      <TopExpenses data={topExpenses} loading={loading} forExport={forExport} year={year} />
    ) },
    { key: 'months', render: (active, forExport) => (
      <MonthHighlights data={monthlyBreakdown} loading={loading} forExport={forExport} year={year} />
    ) },
    { key: 'totals', render: (active, forExport) => (
      <AnnualTotals
        data={annualTotals}
        previous={previousTotals}
        year={year}
        loading={loading}
        active={forExport ? false : active}
        forExport={forExport}
      />
    ) },
    { key: 'closing', render: (active, forExport) => (
      <ReviewClosing year={year} onClose={forExport ? () => {} : handleClose} forExport={forExport} />
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

  if (locked) {
    return (
      <div className="yearly-review" role="dialog" aria-modal="true" aria-label={t('yearlyReview.bannerTitle')}>
        <div className="yearly-review__header">
          <div style={{ flex: 1 }} />
          <button className="yearly-review__close" onClick={handleClose} aria-label={t('yearlyReview.close')}>✕</button>
        </div>
        <div className="review-card review-card--cover">
          <p className="review-card__eyebrow">✦ Smart Finance</p>
          <h1 className="review-card__title">{t('yearlyReview.locked.title').replace('{year}', year)}</h1>
          <p className="review-card__subtitle">{t('yearlyReview.locked.hint')}</p>
          <button className="review-closing-back" onClick={goToPreviousYear}>
            {t('yearlyReview.locked.viewPastYears')}
          </button>
        </div>
      </div>
    );
  }

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
        <ShareCardButton
          exporting={exporting}
          onClick={() => shareCard({ cardKey: cardDefs[currentIndex].key, year })}
        />
        <button className="yearly-review__close" onClick={handleClose} aria-label={t('yearlyReview.close')}>✕</button>
      </div>

      <div className="yearly-review__viewport">
        <div
          className="yearly-review__track"
          style={{ transform: `translateX(-${currentIndex * 100}vw)` }}
        >
          {cardDefs.map((card, i) => (
            <div key={card.key} className="yearly-review__card-slot">
              {card.render(i === currentIndex, false)}
            </div>
          ))}
        </div>
      </div>

      {currentIndex > 0 && (
        <button
          className="yearly-review__nav yearly-review__nav--prev"
          onClick={prev}
          aria-label={t('yearlyReview.prevCard')}
        >
          ‹
        </button>
      )}
      {currentIndex < total - 1 && (
        <button
          className="yearly-review__nav yearly-review__nav--next"
          onClick={next}
          aria-label={t('yearlyReview.nextCard')}
        >
          ›
        </button>
      )}

      <CardExportStage stageRef={stageRef}>
        {cardDefs[currentIndex].render(false, true)}
      </CardExportStage>
    </div>
  );
}
