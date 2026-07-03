import { useMemo } from 'react';
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTheme } from '@/hooks/useTheme';
import zh from '@/locales/zh';
import en from '@/locales/en';

ChartJS.register(LineElement, PointElement, CategoryScale, LinearScale, Filler, Tooltip, Legend);

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
        borderColor: colors.income,
        backgroundColor: colors.income,
        pointBackgroundColor: colors.income,
        pointRadius: 2.5,
        pointHoverRadius: 4,
        borderWidth: 2,
        tension: 0.3,
        // 收入線往支出線填色：收入在上填淡綠（有結餘），反超到下方填淡紅（透支）
        fill: {
          target: 1,
          above: withAlpha(colors.income, 0.16),
          below: withAlpha(colors.expense, 0.16),
        },
      },
      {
        label: t('yearlyReview.monthlyChart.expense'),
        data: data.map((d) => d?.expense ?? 0),
        borderColor: colors.expense,
        backgroundColor: colors.expense,
        pointBackgroundColor: colors.expense,
        pointRadius: 2.5,
        pointHoverRadius: 4,
        borderWidth: 2,
        tension: 0.3,
        fill: false,
      },
    ],
  }), [data, monthLabels, t, colors]);

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        position: 'top',
        labels: {
          color: colors.text,
          font: { size: 11 },
          usePointStyle: true,
          pointStyle: 'circle',
          boxWidth: 6,
          boxHeight: 6,
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
        <Line data={chartData} options={options} />
      </div>
    </div>
  );
}
