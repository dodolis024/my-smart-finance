import { useMemo } from 'react';
import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip } from 'chart.js';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatMoneyInteger } from '@/lib/utils';
import { useTheme } from '@/hooks/useTheme';
import ReviewExportFooter from './ReviewExportFooter';
import {
  CHART_COLORS_ROSE, CHART_COLORS_GRAY, CHART_COLORS_DAWN, CHART_COLORS_SODA,
  CHART_COLORS_LAVENDER, CHART_COLORS_SORBET, CHART_COLORS_PEACH, CHART_COLORS_LIME,
  CHART_COLORS,
} from '@/lib/constants';

ChartJS.register(ArcElement, Tooltip);

const THEME_PALETTES = {
  rose: CHART_COLORS_ROSE, graphite: CHART_COLORS_GRAY, dawn: CHART_COLORS_DAWN,
  soda: CHART_COLORS_SODA, lavender: CHART_COLORS_LAVENDER, sorbet: CHART_COLORS_SORBET,
  peach: CHART_COLORS_PEACH, lime: CHART_COLORS_LIME,
};

const MAX_RING_ITEMS = 3;

export default function TopCategory({ data = [], loading, expenseCount = 0, totalExpense = 0, forExport = false, year }) {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const palette = THEME_PALETTES[theme] || CHART_COLORS;

  // Only the top 3 are shown — a circular hole can't fit more legend rows
  // without the outer rows overflowing past the ring at top/bottom.
  const topEntries = useMemo(() => data.slice(0, MAX_RING_ITEMS), [data]);

  const chartData = useMemo(() => ({
    labels: topEntries.map((d) => d.category),
    datasets: [{
      data: topEntries.map((d) => d.amount),
      backgroundColor: topEntries.map((_, i) => palette[i % palette.length]),
      borderColor: 'transparent',
      borderWidth: 2,
      hoverOffset: 6,
    }],
  }), [topEntries, palette]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: true,
    animation: forExport ? false : undefined,
    cutout: '74%',
    plugins: {
      legend: { display: false },
      tooltip: {
        displayColors: false,
        callbacks: {
          title: () => '',
          label: (ctx) => `${topEntries[ctx.dataIndex]?.category}: ${topEntries[ctx.dataIndex]?.percentage}%`,
        },
      },
    },
  }), [topEntries, forExport]);

  if (loading) {
    return (
      <div className="review-card review-card--top-category">
        <p className="review-card__loading">{t('yearlyReview.loading')}</p>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="review-card review-card--top-category">
        <p className="review-card__title">{t('yearlyReview.topCategory.title')}</p>
        <p className="review-card__empty">{t('yearlyReview.topCategory.noData')}</p>
      </div>
    );
  }

  return (
    <div className="review-card review-card--top-category">
      <div className="review-category-badge">{t('yearlyReview.topCategory.title')}</div>

      <div className="review-category-ring-wrap">
        <Doughnut data={chartData} options={chartOptions} />
        <div className="review-category-ring-legend">
          {topEntries.map((item, i) => (
            <div key={item.category} className="review-category-legend-row">
              <span
                className="review-category-legend-row__dot"
                style={{ background: palette[i % palette.length] }}
              />
              <span className="review-category-legend-row__name">{item.category}</span>
              <span className="review-category-legend-row__pct">{item.percentage}%</span>
            </div>
          ))}
        </div>
      </div>

      {(expenseCount > 0 || totalExpense > 0) && (
        <p className="review-category-summary">
          {t('yearlyReview.topCategory.summary', { count: expenseCount, amount: formatMoneyInteger(totalExpense) })}
        </p>
      )}
      {forExport && <ReviewExportFooter year={year} />}
    </div>
  );
}
