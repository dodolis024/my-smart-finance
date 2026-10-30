import { useMemo } from 'react';
import {
  Chart as ChartJS,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
} from 'chart.js';
import { Chart } from 'react-chartjs-2';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTheme } from '@/hooks/useTheme';
import { useDisplayAmount } from '@/contexts/DisplayAmountContext';
import InfoTip from '@/components/spending-analysis/InfoTip';
import { CHART_SPANS, monthAxisLabels } from '@/lib/spendingAnalysis';
import { cssVar, compact } from '@/components/spending-analysis/chartHelpers';

ChartJS.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

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
 * 「平常」的橫向虛線：直接畫在圖上，不當成一組資料。這樣從圖的最左邊畫到最右邊，
 * 切換一季／一年時長度不變、也不跑動畫；畫在長條之後，超過平常的長條不會把線蓋住。
 * 高度與顏色從 options.plugins.usualLine 讀（value 是 null 就不畫）。
 */
const usualLinePlugin = {
  id: 'usualLine',
  afterDatasetsDraw(chart, _args, opts) {
    if (opts.value == null) return;
    const { ctx, chartArea, scales } = chart;
    // 對齊半個像素，1.5px 的線才不會糊
    const y = Math.round(scales.y.getPixelForValue(opts.value)) + 0.5;
    ctx.save();
    ctx.strokeStyle = opts.color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(chartArea.left, y);
    ctx.lineTo(chartArea.right, y);
    ctx.stroke();
    ctx.restore();
  },
};
const chartPlugins = [usualLinePlugin];

const canOpen = (m) => !!m && m.dailyTxs.length > 0;

/**
 * 每個月花多少（大額單筆照樣算在長條裡）：拿來算平常的那幾個月加上正在看的月份。標題旁切換一季／半年／一年，
 * 平常也跟著換成那幾個月的平均。有旅程的月份上面疊一段斜線；這個月還沒過完就畫到目前為止花的；
 * 「平常」畫成一條橫向虛線。點長條會打開那個月的明細。
 */
export default function MonthlyBarsChart({ analysis, labelOf, labelOfYm, onSelectMonth, span, onChangeSpan }) {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const { formatTotal } = useDisplayAmount();
  const { months, baseline } = analysis;
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
        data: months.map((m) => m.daily),
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
        data: months.map((m) => (m.trip ? m.trip : null)),
        backgroundColor: months.map((_, i) => (i === last ? current : other)),
        borderColor: months.map((_, i) => (i === last ? colors.primary : colors.tint)),
        borderWidth: 1,
        borderRadius: 4,
        stack: 'spend',
        maxBarThickness: 48,
      });
    }
    return { labels: monthAxisLabels(months.map((m) => m.ym), labelOf), datasets };
  }, [months, last, colors, labelOf, t]);

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    // 換主題時的換色跟頁面其他元素的轉場一樣 0.2 秒（Chart.js 預設 1 秒）
    animations: { colors: { duration: 200 } },
    interaction: { mode: 'index', intersect: false },
    onClick: (_, elements) => {
      const index = elements[0]?.index;
      if (index != null && canOpen(months[index])) onSelectMonth(months[index]);
    },
    onHover: (event, elements) => {
      const index = elements[0]?.index;
      event.native.target.style.cursor = index != null && canOpen(months[index]) ? 'pointer' : 'default';
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          // 橫軸只在換年的地方寫年份，提示框一律寫完整的年月
          title: (items) => (items.length ? labelOfYm(months[items[0].dataIndex].ym) : ''),
          label: (ctx) => (ctx.parsed.y == null ? null : ` ${ctx.dataset.label}: ${formatTotal(ctx.parsed.y)}`),
          // 虛線不是一組資料，平常多少另外接在各段金額後面
          afterBody: () => (baseline == null ? [] : [` ${t('spendingAnalysis.chart.usual')}: ${formatTotal(baseline)}`]),
          footer: (items) => (canOpen(months[items[0]?.dataIndex]) ? t('spendingAnalysis.chart.clickHint') : ''),
        },
      },
      usualLine: { value: baseline, color: colors.text },
    },
    scales: {
      x: {
        stacked: true,
        grid: { display: false },
        ticks: {
          // 一年有 13 根：不准 Chart.js 自己跳著顯示或轉斜，不然寫著年份的那個月可能被跳過
          autoSkip: false,
          maxRotation: 0,
          color: (ctx) => (ctx.index === last ? colors.text : colors.muted),
          font: (ctx) => ({ size: 12, weight: ctx.index === last ? 700 : 400 }),
        },
      },
      y: {
        stacked: true,
        beginAtZero: true,
        // 平常比每根長條都高時，刻度也要容得下那條虛線
        suggestedMax: baseline ?? undefined,
        grid: { color: colors.grid },
        border: { display: false },
        ticks: { color: colors.muted, font: { size: 10 }, callback: compact, maxTicksLimit: 5 },
      },
    },
  }), [months, last, baseline, colors, formatTotal, labelOfYm, onSelectMonth, t]);

  const legends = [
    months.some((m) => m.trip > 0) && t('spendingAnalysis.chart.legendTrip'),
    baseline != null && t('spendingAnalysis.chart.legendUsual'),
  ].filter(Boolean);
  // 英文的圖例是從句子中間拆出來的小寫片段，自己成一句時首字母大寫
  const legendText = legends.join(t('spendingAnalysis.chart.legendJoin'));
  const legendSentence = legendText.charAt(0).toUpperCase() + legendText.slice(1);

  return (
    <section className="analysis-card analysis-chart">
      <div className="analysis-chart__head">
        <h3 className="analysis-card__title">
          {t('spendingAnalysis.chart.title')}
          {legends.length > 0 && <InfoTip>{legendSentence}</InfoTip>}
        </h3>
        <div className="analysis-segment" role="group" aria-label={t('spendingAnalysis.chart.spanLabel')}>
          {CHART_SPANS.map((n) => (
            <button
              key={n}
              type="button"
              className={`analysis-segment__btn${n === span ? ' is-active' : ''}`}
              aria-pressed={n === span}
              onClick={() => onChangeSpan(n)}
            >
              {t(`spendingAnalysis.chart.span${n}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="analysis-chart__canvas">
        <Chart type="bar" data={data} options={options} plugins={chartPlugins} />
      </div>
    </section>
  );
}
