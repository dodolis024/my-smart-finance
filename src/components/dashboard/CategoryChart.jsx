import { useMemo, useRef, useEffect } from 'react';
import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip } from 'chart.js';
import { CHART_COLORS, CHART_COLORS_ROSE, CHART_COLORS_GRAY } from '@/lib/constants';
import { useTheme } from '@/hooks/useTheme';
import { formatMoney } from '@/lib/utils';

ChartJS.register(ArcElement, Tooltip);

const THEME_PALETTES = { rose: CHART_COLORS_ROSE, gray: CHART_COLORS_GRAY };

export default function CategoryChart({ history = [], incomeCategories = [] }) {
  const { theme } = useTheme();
  const palette = THEME_PALETTES[theme] || CHART_COLORS;

  const pairs = useMemo(() => {
    const incomeSet = new Set(incomeCategories);
    const byCat = {};
    (history || []).forEach((tx) => {
      const cat = (tx.category && String(tx.category).trim()) ? tx.category : '未分類';
      if (incomeSet.has(cat)) return;
      const amt = typeof tx.twdAmount === 'number' ? tx.twdAmount : 0;
      byCat[cat] = (byCat[cat] || 0) + amt;
    });
    return Object.entries(byCat)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  }, [history, incomeCategories]);

  const chartData = useMemo(() => ({
    labels: pairs.map((p) => p.label),
    datasets: [{
      data: pairs.map((p) => Math.abs(p.value)),
      backgroundColor: pairs.map((_, i) => palette[i % palette.length]),
      borderColor: '#fff',
      borderWidth: 2,
      hoverOffset: 6,
    }],
  }), [pairs]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: true,
    layout: { padding: 8 },
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
  }), []);

  if (pairs.length === 0) {
    return <p className="category-stats-empty">本月尚無消費資料</p>;
  }

  const colors = pairs.map((_, i) => palette[i % palette.length]);

  return (
    <>
      <Doughnut data={chartData} options={chartOptions} style={{ maxWidth: 'var(--chart-max-width)', margin: '0.5rem auto', display: 'block' }} />
      <div className="category-chart-legend" id="categoryChartLegend">
        {pairs.map((p, i) => (
          <span key={p.label} className="legend-item">
            <span className="legend-color" style={{ background: colors[i] }} />
            {p.label}
          </span>
        ))}
      </div>
      <ul className="category-stats-list" id="categoryStats">
        {pairs.map((p) => (
          <li key={p.label}>
            <span className="cat-name">{p.label}</span>
            <span className="cat-amount">{formatMoney(p.value)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
