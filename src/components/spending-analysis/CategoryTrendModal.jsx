import { useState, useEffect, useMemo } from 'react';
import {
  Chart as ChartJS,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
} from 'chart.js';
import { Chart } from 'react-chartjs-2';
import Modal from '@/components/common/Modal';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTheme } from '@/hooks/useTheme';
import { useDisplayAmount } from '@/contexts/DisplayAmountContext';
import { formatOriginalMoney } from '@/lib/utils';
import { monthAxisLabels } from '@/lib/spendingAnalysis';
import { ChangePill } from '@/components/spending-analysis/CategoryChanges';

ChartJS.register(LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip);

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

/** 1、2、5 × 10 的次方裡，不小於 raw 的最小值（刻度間隔用） */
function niceStep(raw) {
  const pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((n) => n * pow).find((step) => step >= raw);
}

/**
 * 縱軸的範圍：最低、最高的點各往外留半格，取到整數刻度。
 * 每個月都花差不多的分類（飲食都在 1.1–1.7 萬）從 0 開始，線會擠在上面看不出起伏；
 * 每個點都標了金額，不從 0 開始也不會看錯。有 0 的月份就從 0 開始。
 */
function axisRange(values) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (lo <= 0 || hi <= lo) return { min: 0 };
  const step = niceStep((hi - lo) / 4);
  return {
    min: Math.max(0, Math.floor((lo - step / 2) / step) * step),
    max: Math.ceil((hi + step / 2) / step) * step,
    stepSize: step,
  };
}

// 金額字的高度與跟點的距離
const LABEL_HEIGHT = 12;
const LABEL_GAP = 10;

/**
 * 每個點標金額：谷底的點（左右都比它高）標在下方，其他標在上方，字才不會壓在線上；
 * 剛好碰到平常的虛線就換到另一邊
 */
const valueLabels = {
  id: 'categoryTrendLabels',
  afterDatasetsDraw(chart, _, opts) {
    const { ctx } = chart;
    const values = chart.data.datasets[0].data;
    const usualY = opts.usual != null ? chart.scales.y.getPixelForValue(opts.usual) : null;
    ctx.save();
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = opts.color;
    // 位置用數值直接換算，不用點目前畫到哪：開圖時點會從底部長上來，跟著點走的話字會一路跳動
    values.forEach((value, i) => {
      if (value == null) return;
      const point = { x: chart.scales.x.getPixelForValue(i), y: chart.scales.y.getPixelForValue(value) };
      const neighbors = [values[i - 1], values[i + 1]].filter((v) => v != null);
      let below = neighbors.length > 0 && neighbors.every((v) => v > value);
      const top = (b) => (b ? point.y + LABEL_GAP : point.y - LABEL_GAP - LABEL_HEIGHT);
      if (usualY != null && usualY >= top(below) && usualY <= top(below) + LABEL_HEIGHT) below = !below;
      ctx.textBaseline = 'top';
      ctx.fillText(opts.format(value), point.x, top(below));
    });
    ctx.restore();
  },
};

/**
 * 點分類打開：這個分類近幾個月花了多少的折線，只回答「變多還是變少」。
 * 這個月的點就是到目前為止花的（跟標題、清單上的數字一樣；日期範圍寫在標題）。
 * 平常一個月花多少畫成淡灰色虛線當參考，金額滑過圖表時才在提示框裡出現。
 * 交易收在最下面，點了才展開。
 */
export default function CategoryTrendModal({ category, analysis, labelOf, labelOfYm, onClose }) {
  const { t, lang } = useLanguage();
  const { theme } = useTheme();
  const { toDisplay, formatTotal } = useDisplayAmount();
  const [showTxs, setShowTxs] = useState(false);
  const name = category?.name;

  useEffect(() => {
    setShowTxs(false);
  }, [name]);

  const colors = useMemo(() => ({
    primary: cssVar('--color-primary', '#b59c80'),
    card: cssVar('--color-card', '#ffffff'),
    text: cssVar('--color-text', '#333333'),
    secondary: cssVar('--color-text-secondary', '#797169'),
    muted: cssVar('--color-text-muted', '#999999'),
    grid: cssVar('--color-border-light', '#eeeeee'),
  }), [theme]); // eslint-disable-line react-hooks/exhaustive-deps -- theme 僅作觸發器，主題切換時需重新讀取 cssVar 顏色

  const { months, isCurrent, daysElapsed, targetYm } = analysis;
  const last = months.length - 1;
  const series = useMemo(() => (category ? category.series : []), [category]);
  // 平常一個月；沒有平常可比（帳本剛開始）就不畫
  const usual = category?.usual || null;

  const data = useMemo(() => ({
    labels: monthAxisLabels(months.map((m) => m.ym), labelOf),
    datasets: [{
      label: name,
      data: series,
      borderColor: colors.primary,
      backgroundColor: colors.card,
      borderWidth: 2.5,
      pointRadius: series.map((_, i) => (i === last ? 6 : 4.5)),
      pointBackgroundColor: series.map((_, i) => (i === last ? colors.primary : colors.card)),
      pointBorderColor: colors.primary,
      pointBorderWidth: 2,
      // 剛好落在縱軸最底（$0）的點不要被圖表邊界切掉一半
      clip: false,
      tension: 0,
    }, ...(usual ? [{
      data: series.map(() => usual),
      borderColor: colors.muted,
      borderDash: [4, 4],
      borderWidth: 1.25,
      pointRadius: 0,
      pointHoverRadius: 0,
    }] : [])],
  }), [name, series, months, last, usual, colors, labelOf]);

  const yRange = useMemo(() => (series.length ? axisRange(usual ? [...series, usual] : series) : { min: 0 }), [series, usual]);

  const hasZero = series.some((v) => v === 0);

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animations: { colors: { duration: 200 } },
    layout: { padding: { top: 24 } },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        // 虛線本身不列一行，平常的金額放在最下面一行
        filter: (item) => item.datasetIndex === 0,
        displayColors: false,
        // 提示框離點遠一點，不要蓋住標在點上下的金額
        caretPadding: 32,
        footerFont: { weight: 400 },
        callbacks: {
          title: (items) => (items.length ? labelOfYm(months[items[0].dataIndex].ym) : ''),
          label: (ctx) => formatTotal(ctx.parsed.y),
          footer: () => (usual ? t('spendingAnalysis.categories.usual', { amount: formatTotal(usual) }) : ''),
        },
      },
      categoryTrendLabels: {
        color: colors.text,
        format: formatTotal,
        usual,
      },
    },
    scales: {
      x: {
        // 兩端各留半格：金額標在點的正上方，最左、最右那一點的字才不會壓到刻度或被切掉
        offset: true,
        grid: { display: false },
        ticks: {
          // 有 $0 的月份，金額標在點下方，月份往下讓出位置
          padding: hasZero ? 24 : 3,
          // 每個月都寫、不轉斜：寫著年份的那個月才不會被跳過
          autoSkip: false,
          maxRotation: 0,
          color: (ctx) => (ctx.index === last ? colors.text : colors.muted),
          font: (ctx) => ({ size: 12, weight: ctx.index === last ? 700 : 400 }),
        },
      },
      y: {
        min: yRange.min,
        max: yRange.max,
        // 從 0 開始的才自動往上留空間；有自己算範圍的已經各留了半格
        grace: yRange.max == null ? '10%' : 0,
        grid: { color: colors.grid },
        border: { display: false },
        ticks: { color: colors.muted, font: { size: 11 }, callback: compact, maxTicksLimit: 6, stepSize: yRange.stepSize },
      },
    },
  }), [months, last, colors, formatTotal, labelOfYm, yRange, usual, hasZero, t]);

  if (!category) return null;

  const [, monthNum] = targetYm.split('-').map(Number);
  const range = isCurrent ? `${monthNum}/1 – ${monthNum}/${daysElapsed}` : labelOf(targetYm);
  const compareText = category.usual == null ? null : t('spendingAnalysis.categories.usual', { amount: formatTotal(category.usual) });
  const sep = lang === 'en' ? ' · ' : '・';
  const txs = [...category.txs].sort((a, b) => `${b.date} ${b.time || ''}`.localeCompare(`${a.date} ${a.time || ''}`));
  const dateOf = (tx) => {
    const [, m, d] = tx.date.split('-').map(Number);
    return `${m}/${d}`;
  };

  return (
    <Modal isOpen={!!category} onClose={onClose} className="category-detail-modal" titleId="category-trend-title">
      <div className="category-detail-modal__backdrop" onClick={onClose} />
      <div className="category-detail-modal__dialog scrollbar-on-scroll analysis-cat-trend" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="category-detail-modal__close" aria-label={t('common.close')} onClick={onClose}>×</button>
        <h2 id="category-trend-title" className="category-detail-modal__title">{category.name}</h2>

        <div className="analysis-cat-trend__summary">
          <span className="category-detail-modal__total">{formatTotal(category.current)}</span>
          <span className="category-detail-modal__meta">
            {range}
            {compareText && `${sep}${compareText}`}
          </span>
          <ChangePill ratio={category.ratio} />
        </div>

        <div className="analysis-cat-trend__canvas">
          <Chart type="line" data={data} options={options} plugins={[valueLabels]} />
        </div>

        {txs.length > 0 && (
          <ul className="analysis-trip-detail__list analysis-cat-trend__list">
            <li className="analysis-trip-detail__toggle-row">
              <button
                type="button"
                className="analysis-trip-detail__toggle"
                aria-expanded={showTxs}
                onClick={() => setShowTxs((v) => !v)}
              >
                <span className={`analysis-trip-detail__chevron${showTxs ? ' is-open' : ''}`} aria-hidden="true">›</span>
                {t('spendingAnalysis.categoryTrend.showTxs', { count: txs.length })}
              </button>
            </li>
            {showTxs && txs.map((tx) => (
              <li key={tx.id} className="analysis-cat-trend__tx">
                <span className="analysis-trip-entry__date">{dateOf(tx)}</span>
                <span className="analysis-trip-entry__name">{tx.itemName}</span>
                <span className="analysis-trip-entry__original">
                  {tx.currency && tx.currency !== 'TWD' && tx.originalAmount != null ? formatOriginalMoney(tx.originalAmount, tx.currency) : ''}
                </span>
                <span className="analysis-trip-entry__amount">{formatTotal(toDisplay(tx).value)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
