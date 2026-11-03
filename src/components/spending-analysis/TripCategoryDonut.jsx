import { useMemo } from 'react';
import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip } from 'chart.js';
import { useTheme } from '@/hooks/useTheme';
import { useDisplayAmount } from '@/contexts/DisplayAmountContext';
import { getChartPalette } from '@/lib/categoryColor';
import { cssVar } from '@/components/spending-analysis/chartHelpers';

ChartJS.register(ArcElement, Tooltip);

/** 各分類占比取整數，加總剛好 100：先無條件捨去，差的幾個百分點給小數部分最大的 */
function wholePercents(values, total) {
  if (!total) return values.map(() => 0);
  const raw = values.map((v) => (v / total) * 100);
  const result = raw.map(Math.floor);
  let left = 100 - result.reduce((sum, p) => sum + p, 0);
  raw.map((p, i) => [p - result[i], i])
    .sort((a, b) => b[0] - a[0])
    .forEach(([, i]) => { if (left > 0) { result[i] += 1; left -= 1; } });
  return result;
}

/**
 * 旅程明細上方的分類甜甜圈：只算現在算進旅程的交易（排除的不算、手動加入的算）。
 * 顏色照主畫面圓餅圖，依金額排名取主題色盤；右邊直接列金額與占比，不用滑過去看。
 */
export default function TripCategoryDonut({ categories, total }) {
  const { theme } = useTheme();
  const { formatTotal } = useDisplayAmount();
  const palette = getChartPalette(theme);
  const percents = useMemo(() => wholePercents(categories.map((c) => c.value), total), [categories, total]);
  const colors = useMemo(() => categories.map((_, i) => palette[i % palette.length]), [categories, palette]);

  // theme 僅作觸發器，主題切換時重新讀取卡片底色當切片間的分隔線
  const border = useMemo(() => cssVar('--color-card', '#ffffff'), [theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const data = useMemo(() => ({
    labels: categories.map((c) => c.name),
    datasets: [{
      data: categories.map((c) => c.value),
      backgroundColor: colors,
      borderColor: border,
      borderWidth: 2,
      hoverOffset: 4,
    }],
  }), [categories, colors, border]);

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: true,
    cutout: '62%',
    layout: { padding: 4 },
    plugins: {
      legend: { display: false },
      tooltip: {
        displayColors: false,
        callbacks: {
          title: () => '',
          label: (ctx) => `${ctx.label}: ${formatTotal(ctx.raw)} (${percents[ctx.dataIndex]}%)`,
        },
      },
    },
  }), [formatTotal, percents]);

  if (categories.length === 0 || total <= 0) return null;

  return (
    <div className="analysis-trip-donut">
      <div className="analysis-trip-donut__chart">
        <Doughnut data={data} options={options} />
      </div>
      <ul className="analysis-trip-donut__legend">
        {categories.map((c, i) => (
          <li key={c.name} className="analysis-trip-donut__item">
            <span className="analysis-trip-donut__dot" style={{ background: colors[i] }} />
            <span className="analysis-trip-donut__name">{c.name}</span>
            <span className="analysis-trip-donut__amount">{formatTotal(c.value)}</span>
            <span className="analysis-trip-donut__pct">{percents[i]}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
