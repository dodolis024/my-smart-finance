import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDisplayAmount } from '@/contexts/DisplayAmountContext';
import { EARLY_MONTH_DAYS } from '@/lib/spendingAnalysis';
import { formatTripRange } from '@/lib/trips';

const COLLAPSED_COUNT = 6;
const SPARK_W = 72;
const SPARK_H = 24;

/** 分類的小走勢線：最後一點是這個月（還沒過完時用推估值，那一段畫虛線，免得看起來像在下滑） */
function Sparkline({ values, lastIsEstimate }) {
  if (values.length < 2) return <span className="analysis-spark" />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * (SPARK_W - 6) + 3,
    SPARK_H - 3 - ((v - min) / (max - min || 1)) * (SPARK_H - 6),
  ]);
  const solid = lastIsEstimate ? pts.slice(0, -1) : pts;
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg className="analysis-spark" width={SPARK_W} height={SPARK_H} aria-hidden="true">
      {solid.length > 1 && <polyline points={solid.map((p) => p.join(',')).join(' ')} />}
      {lastIsEstimate && (
        <line x1={pts[pts.length - 2][0]} y1={pts[pts.length - 2][1]} x2={lx} y2={ly} strokeDasharray="3 3" />
      )}
      <circle cx={lx} cy={ly} r="2.5" />
    </svg>
  );
}

export function ChangePill({ ratio }) {
  // 新出現的分類沒有比例可比；左邊的小字已經寫了「新出現的分類」，這裡留白
  if (ratio == null) return <span />;
  const percent = Math.round(Math.abs(ratio) * 100);
  // 四捨五入後是 0%（房租、訂閱這種固定金額）就不放箭頭，免得看起來像變少
  if (percent === 0) return <span className="analysis-pill">±0%</span>;
  const up = ratio > 0;
  return (
    <span className={`analysis-pill ${up ? 'is-up' : 'is-down'}`}>
      {up ? '▲' : '▼'} {percent}%
    </span>
  );
}

/**
 * 每個分類：本月金額、跟平常比的變化、近幾個月的小走勢線。這個月的旅程整趟算一列（平常沒有旅程，整趟都是多花的）。
 * 排序與結論句同一個標準（多花的金額），預設只顯示前幾名。
 */
export default function CategoryChanges({ analysis, currentYear, onSelectCategory, onSelectTrip }) {
  const { t } = useLanguage();
  const { formatTotal } = useDisplayAmount();
  const [expanded, setExpanded] = useState(false);
  const { categories, targetTrips, months, isCurrent, isEarly, baseline } = analysis;
  // 這個月還沒過完：跟平常同期比，走勢線最後一點用月底預估（虛線）；月初還不比，走勢線只畫到上個月
  const estimating = isCurrent && !isEarly;
  const all = [
    ...targetTrips.map((row) => ({ kind: 'trip', key: `trip:${row.trip.id}`, sortBy: row.value, row })),
    ...categories.map((cat) => ({ kind: 'category', key: cat.name, sortBy: cat.diff ?? cat.current, cat })),
  ].sort((a, b) => b.sortBy - a.sortBy);
  const rows = expanded ? all : all.slice(0, COLLAPSED_COUNT);
  const startIndex = months.findIndex((m) => !m.beforeStart);

  const subline = (cat) => {
    if (cat.risingMonths >= 2) {
      return <span className="analysis-cat__sub is-alert">{t('spendingAnalysis.categories.rising', { count: cat.risingMonths })}</span>;
    }
    if (baseline == null) return null;
    if (!cat.usual) return <span className="analysis-cat__sub">{t('spendingAnalysis.categories.new')}</span>;
    return (
      <span className="analysis-cat__sub">
        {estimating
          ? t('spendingAnalysis.categories.usualToDate', { amount: formatTotal(cat.baseline) })
          : t('spendingAnalysis.categories.usual', { amount: formatTotal(cat.usual) })}
      </span>
    );
  };

  return (
    <section className={`analysis-card analysis-cats${expanded ? ' is-expanded' : ''}`}>
      <h3 className="analysis-card__title">{t('spendingAnalysis.categories.title')}</h3>
      <p className="analysis-card__subtitle">
        {isEarly
          ? t('spendingAnalysis.categories.subtitleEarly', { day: EARLY_MONTH_DAYS })
          : t('spendingAnalysis.categories.subtitle')}
        {targetTrips.length > 0 && t('spendingAnalysis.categories.tripNote')}
      </p>
      {all.length === 0 ? (
        <p className="analysis-empty">{t('spendingAnalysis.categories.empty')}</p>
      ) : (
        <ul className="analysis-cat-list">
          {rows.map((item) => {
            if (item.kind === 'trip') {
              const { trip, value } = item.row;
              return (
                <li key={item.key}>
                  <button type="button" className="analysis-cat" onClick={() => onSelectTrip(trip.id)}>
                    <span className="analysis-cat__name-wrap">
                      <span className="analysis-cat__name">✈︎ {trip.name}</span>
                      <span className="analysis-cat__sub">
                        {t('spendingAnalysis.categories.tripSub', { range: formatTripRange(trip.start, trip.end, currentYear) })}
                      </span>
                    </span>
                    <span className="analysis-spark" />
                    <span className="analysis-cat__amount">{formatTotal(value)}</span>
                    <span className="analysis-pill">{t('spendingAnalysis.categories.tripPill')}</span>
                  </button>
                </li>
              );
            }
            const { cat } = item;
            const trend = cat.series.slice(Math.max(startIndex, 0), isEarly ? -1 : undefined);
            if (estimating && trend.length) trend[trend.length - 1] = cat.projected;
            return (
              <li key={cat.name}>
                <button
                  type="button"
                  className="analysis-cat"
                  onClick={() => onSelectCategory(cat)}
                  disabled={cat.txs.length === 0}
                >
                  <span className="analysis-cat__name-wrap">
                    <span className="analysis-cat__name">{cat.name}</span>
                    {subline(cat)}
                  </span>
                  <Sparkline values={trend} lastIsEstimate={estimating} />
                  {/* 一律顯示實際花的，跟點進去的明細加起來一樣；還沒過完的月份，百分比是跟平常同期比 */}
                  <span className="analysis-cat__amount">{formatTotal(cat.current)}</span>
                  <ChangePill ratio={cat.ratio} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {all.length > COLLAPSED_COUNT && (
        <button type="button" className="analysis-link" onClick={() => setExpanded((v) => !v)}>
          {expanded
            ? t('spendingAnalysis.categories.showLess')
            : t(targetTrips.length ? 'spendingAnalysis.categories.showAllWithTrips' : 'spendingAnalysis.categories.showAll', { count: all.length })}
        </button>
      )}
    </section>
  );
}
