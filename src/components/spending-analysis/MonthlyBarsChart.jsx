import { useMemo } from 'react';
import {
  Chart as ChartJS,
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
} from 'chart.js';
import { Chart } from 'react-chartjs-2';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTheme } from '@/hooks/useTheme';
import { useDisplayAmount } from '@/contexts/DisplayAmountContext';

ChartJS.register(BarController, BarElement, LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip);

function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** 刻度只要看得出量級：1,234 → 1.2k */
function compact(value) {
  if (Math.abs(value) < 1000) return String(Math.round(value));
  const k = value / 1000;
  return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
}

/** 旅程那段的斜線填色：淡底＋斜線，不用另一個色相也分得出來 */
function stripes(background, line) {
  const size = 8;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-2, size + 2); ctx.lineTo(size + 2, -2);
  ctx.moveTo(-2, 2); ctx.lineTo(2, -2);
  ctx.moveTo(size - 2, size + 2); ctx.lineTo(size + 2, size - 2);
  ctx.stroke();
  return ctx.createPattern(canvas, 'repeat');
}

/**
 * 近 6 個月的日常支出長條（不含大額單筆）。有旅程的月份上面疊一段斜線；這個月還沒過完時，
 * 再疊一段淡色的「月底預估」；「平常」（不含旅程）畫成一條橫向虛線。點長條會打開那個月的明細。
 */
export default function MonthlyBarsChart({ analysis, labelOf, onSelectMonth }) {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const { formatTotal } = useDisplayAmount();
  const { months, isCurrent, isEarly, projected, toDate, baseline } = analysis;
  const last = months.length - 1;

  const colors = useMemo(() => ({
    primary: cssVar('--color-primary', '#b59c80'),
    tint: cssVar('--color-primary-tint', 'rgba(181, 156, 128, 0.35)'),
    tintLight: cssVar('--color-primary-tint-light', 'rgba(181, 156, 128, 0.15)'),
    text: cssVar('--color-text-secondary', '#797169'),
    muted: cssVar('--color-text-muted', '#999999'),
    grid: cssVar('--color-border-light', '#eeeeee'),
  }), [theme]); // eslint-disable-line react-hooks/exhaustive-deps -- theme 僅作觸發器，主題切換時需重新讀取 cssVar 顏色

  const data = useMemo(() => {
    const datasets = [
      {
        type: 'bar',
        label: t('spendingAnalysis.chart.everyday'),
        data: months.map((m) => (m.beforeStart ? null : m.daily)),
        backgroundColor: months.map((_, i) => (i === last ? colors.primary : colors.tint)),
        borderRadius: 4,
        stack: 'spend',
        maxBarThickness: 48,
      },
    ];
    if (months.some((m) => m.trip > 0)) {
      const current = stripes(colors.tintLight, colors.primary);
      const other = stripes(colors.tintLight, colors.tint);
      datasets.push({
        type: 'bar',
        label: t('spendingAnalysis.chart.trip'),
        data: months.map((m) => (m.beforeStart || !m.trip ? null : m.trip)),
        backgroundColor: months.map((_, i) => (i === last ? current : other)),
        borderColor: months.map((_, i) => (i === last ? colors.primary : colors.tint)),
        borderWidth: 1,
        borderRadius: 4,
        stack: 'spend',
        maxBarThickness: 48,
      });
    }
    // 月初資料太少不推估，只畫到目前為止的金額
    if (isCurrent && !isEarly) {
      datasets.push({
        type: 'bar',
        label: t('spendingAnalysis.chart.projected'),
        data: months.map((_, i) => (i === last ? Math.max(0, projected - toDate) : null)),
        isProjection: true,
        backgroundColor: colors.tintLight,
        borderColor: colors.primary,
        borderWidth: 1,
        borderRadius: 4,
        stack: 'spend',
        maxBarThickness: 48,
      });
    }
    if (baseline != null) {
      datasets.push({
        type: 'line',
        label: t('spendingAnalysis.chart.usual'),
        data: months.map(() => baseline),
        borderColor: colors.text,
        borderDash: [5, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: 0,
        stack: 'usual',
      });
    }
    return { labels: months.map((m) => labelOf(m.ym)), datasets };
  }, [months, last, isCurrent, isEarly, projected, toDate, baseline, colors, labelOf, t]);

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    // 換主題時的換色跟頁面其他元素的轉場一樣 0.2 秒（Chart.js 預設 1 秒）
    animations: { colors: { duration: 200 } },
    interaction: { mode: 'index', intersect: false },
    onClick: (_, elements) => {
      const index = elements[0]?.index;
      if (index != null && months[index]?.dailyTxs.length) onSelectMonth(months[index]);
    },
    onHover: (event, elements) => {
      const index = elements[0]?.index;
      event.native.target.style.cursor = index != null && months[index]?.dailyTxs.length ? 'pointer' : 'default';
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            if (ctx.parsed.y == null) return null;
            // 預估那段只是疊在上面的差額，提示框直接講預估的總數比較好懂
            const value = ctx.dataset.isProjection ? projected : ctx.parsed.y;
            return ` ${ctx.dataset.label}: ${formatTotal(value)}`;
          },
          afterBody: (items) => {
            const m = months[items[0]?.dataIndex];
            if (!m) return [];
            if (m.beforeStart) return [t('spendingAnalysis.chart.beforeStart')];
            return m.large > 0 ? [` ${t('spendingAnalysis.chart.large')}: ${formatTotal(m.large)}`] : [];
          },
          footer: (items) => (months[items[0]?.dataIndex]?.dailyTxs.length ? t('spendingAnalysis.chart.clickHint') : ''),
        },
      },
    },
    scales: {
      x: {
        stacked: true,
        grid: { display: false },
        ticks: {
          color: (ctx) => (ctx.index === last ? colors.text : colors.muted),
          font: (ctx) => ({ size: 12, weight: ctx.index === last ? 700 : 400 }),
        },
      },
      y: {
        stacked: true,
        beginAtZero: true,
        grid: { color: colors.grid },
        border: { display: false },
        ticks: { color: colors.muted, font: { size: 10 }, callback: compact, maxTicksLimit: 5 },
      },
    },
  }), [months, last, projected, colors, formatTotal, onSelectMonth, t]);

  const legends = [
    months.some((m) => m.trip > 0) && t('spendingAnalysis.chart.legendTrip'),
    isCurrent && !isEarly && projected > toDate && t('spendingAnalysis.chart.legendProjected'),
    baseline != null && t('spendingAnalysis.chart.legendUsual'),
  ].filter(Boolean);
  const subtitle = t('spendingAnalysis.chart.subtitle', {
    large: t(analysis.largeItems.some((item) => item.included) ? 'spendingAnalysis.largeWordSome' : 'spendingAnalysis.largeWord'),
  }) + (legends.length ? t('spendingAnalysis.chart.legendSep') + legends.join(t('spendingAnalysis.chart.legendJoin')) : '');

  return (
    <section className="analysis-card analysis-chart">
      <h3 className="analysis-card__title">{t('spendingAnalysis.chart.title')}</h3>
      <p className="analysis-card__subtitle">
        {subtitle}
      </p>
      <div className="analysis-chart__canvas">
        <Chart type="bar" data={data} options={options} />
      </div>
    </section>
  );
}
