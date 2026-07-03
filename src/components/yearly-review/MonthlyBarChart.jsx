import { useMemo } from 'react';
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTheme } from '@/hooks/useTheme';
import zh from '@/locales/zh';
import en from '@/locales/en';

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function withAlpha(color, alpha) {
  if (!color.startsWith('#')) return color;
  const hex = color.length === 4
    ? color.slice(1).split('').map((c) => c + c).join('')
    : color.slice(1);
  const value = parseInt(hex, 16);
  const r = (value >> 16) & 255, g = (value >> 8) & 255, b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function MonthlyBarChart({ data = [], loading }) {
  const { t, lang } = useLanguage();
  const { theme } = useTheme();
  const monthLabels = (lang === 'en' ? en : zh).yearlyReview.monthlyChart.months;

  const colors = useMemo(() => ({
    income: cssVar('--color-progress-safe', '#4ade80'),
    expense: cssVar('--color-progress-danger', '#f87171'),
    text: cssVar('--color-text-secondary', '#797169'),
    grid: cssVar('--color-border-light', '#eeeeee'),
  }), [theme]);

  const chartData = useMemo(() => ({
    labels: monthLabels,
    datasets: [
      {
        label: t('yearlyReview.monthlyChart.income'),
        data: data.map((d) => d?.income ?? 0),
        backgroundColor: withAlpha(colors.income, 0.75),
        borderRadius: 4,
        borderSkipped: false,
      },
      {
        label: t('yearlyReview.monthlyChart.expense'),
        data: data.map((d) => d?.expense ?? 0),
        backgroundColor: withAlpha(colors.expense, 0.75),
        borderRadius: 4,
        borderSkipped: false,
      },
    ],
  }), [data, monthLabels, t, colors]);

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        labels: {
          color: colors.text,
          font: { size: 11 },
          boxWidth: 12,
          padding: 12,
        },
      },
      tooltip: {
        callbacks: {
          label: (ctx) => ` ${ctx.dataset.label}: $${ctx.parsed.y.toLocaleString()}`,
        },
      },
    },
    scales: {
      x: {
        grid: { color: colors.grid },
        ticks: { color: colors.text, font: { size: 10 } },
      },
      y: {
        grid: { color: colors.grid },
        ticks: {
          color: colors.text,
          font: { size: 10 },
          callback: (v) => `$${(v / 1000).toFixed(0)}k`,
        },
      },
    },
  }), [colors]);

  if (loading) {
    return (
      <div className="review-card review-card--chart">
        <p className="review-card__loading">{t('yearlyReview.loading')}</p>
      </div>
    );
  }

  return (
    <div className="review-card review-card--chart">
      <p className="review-card__eyebrow">{t('yearlyReview.monthlyChart.title')}</p>
      <div className="review-chart-wrap">
        <Bar data={chartData} options={options} />
      </div>
    </div>
  );
}
