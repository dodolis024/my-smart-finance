import { useCallback, useMemo } from 'react';
import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip } from 'chart.js';
import { CHART_COLORS, CHART_COLORS_ROSE, CHART_COLORS_GRAY, CHART_COLORS_DAWN, CHART_COLORS_SODA, CHART_COLORS_LAVENDER, CHART_COLORS_SORBET, CHART_COLORS_PEACH, CHART_COLORS_LIME } from '@/lib/constants';
import { useTheme } from '@/hooks/useTheme';
import { formatMoney } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';

ChartJS.register(ArcElement, Tooltip);

const THEME_PALETTES = { rose: CHART_COLORS_ROSE, graphite: CHART_COLORS_GRAY, dawn: CHART_COLORS_DAWN, soda: CHART_COLORS_SODA, lavender: CHART_COLORS_LAVENDER, sorbet: CHART_COLORS_SORBET, peach: CHART_COLORS_PEACH, lime: CHART_COLORS_LIME };

export default function CategoryChart({ history = [], incomeCategories = [], onSelectCategory }) {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const palette = THEME_PALETTES[theme] || CHART_COLORS;

  const pairs = useMemo(() => {
    const incomeSet = new Set(incomeCategories);
    const byCat = {};
    (history || []).forEach((tx) => {
      const cat = (tx.category && String(tx.category).trim()) ? tx.category : t('transaction.uncategorized');
      if (incomeSet.has(cat)) return;
      const amt = typeof tx.twdAmount === 'number' ? tx.twdAmount : 0;
      if (!byCat[cat]) byCat[cat] = { value: 0, txs: [] };
      byCat[cat].value += amt;
      byCat[cat].txs.push(tx);
    });
    return Object.entries(byCat)
      .map(([label, { value, txs }]) => ({ label, value, txs }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  }, [history, incomeCategories, t]);

  // 占比分母：與圓餅圖切片一致（都取絕對值）
  const totalExpense = useMemo(
    () => pairs.reduce((sum, p) => sum + Math.abs(p.value), 0),
    [pairs]
  );

  const handleSelect = useCallback((pair) => {
    if (!pair || !onSelectCategory) return;
    onSelectCategory({ ...pair, totalExpense });
  }, [onSelectCategory, totalExpense]);

  const chartData = useMemo(() => ({
    labels: pairs.map((p) => p.label),
    datasets: [{
      data: pairs.map((p) => Math.abs(p.value)),
      backgroundColor: pairs.map((_, i) => palette[i % palette.length]),
      borderColor: '#fff',
      borderWidth: 2,
      hoverOffset: 6,
    }],
  }), [pairs, palette]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: true,
    layout: { padding: 8 },
    onClick: (_evt, elements) => {
      if (!elements || elements.length === 0) return;
      handleSelect(pairs[elements[0].index]);
    },
    onHover: (evt, elements) => {
      const target = evt?.native?.target;
      if (target) target.style.cursor = elements.length ? 'pointer' : 'default';
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        displayColors: false,
        callbacks: {
          title: () => '',
          label: (ctx) => {
            const total = (ctx.dataset.data || []).reduce((s, v) => s + Math.abs(v || 0), 0);
            const val = Math.abs(ctx.dataset.data[ctx.dataIndex] || 0);
            const pct = total ? (val / total) * 100 : 0;
            return `${ctx.label}: ${pct.toFixed(1)}%`;
          },
        },
      },
    },
  }), [handleSelect, pairs]);

  if (pairs.length === 0) {
    return <p className="category-stats-empty">{t('dashboard.noExpenseData')}</p>;
  }

  const colors = pairs.map((_, i) => palette[i % palette.length]);
  const clickable = !!onSelectCategory;

  return (
    <>
      <Doughnut data={chartData} options={chartOptions} style={{ maxWidth: 'var(--chart-max-width)', margin: '0.5rem auto', display: 'block' }} />
      <div className="category-chart-legend" id="categoryChartLegend">
        {pairs.map((p, i) => (
          clickable ? (
            <button
              key={p.label}
              type="button"
              className="legend-item is-clickable"
              onClick={() => handleSelect(p)}
            >
              <span className="legend-color" style={{ background: colors[i] }} />
              {p.label}
            </button>
          ) : (
            <span key={p.label} className="legend-item">
              <span className="legend-color" style={{ background: colors[i] }} />
              {p.label}
            </span>
          )
        ))}
      </div>
      <ul className="category-stats-list" id="categoryStats">
        {pairs.map((p) => (
          <li
            key={p.label}
            className={clickable ? 'clickable' : ''}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={clickable ? () => handleSelect(p) : undefined}
            onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelect(p); } } : undefined}
          >
            <span className="cat-name">{p.label}</span>
            <span className="cat-amount">{formatMoney(p.value)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
