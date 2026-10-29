import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDisplayAmount } from '@/contexts/DisplayAmountContext';
import InfoTip from '@/components/spending-analysis/InfoTip';

const COLLAPSED_COUNT = 6;
const SPARK_W = 72;
const SPARK_H = 24;

/**
 * 分類的小走勢線：最後一點是這個月實際花的。還沒過完（inProgress）時最後一段畫虛線，
 * 表示這一點還在變、不是突然少花了（數字不推估，照實際的）
 */
function Sparkline({ values, inProgress }) {
  if (values.length < 2) return <span className="analysis-spark" />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * (SPARK_W - 6) + 3,
    SPARK_H - 3 - ((v - min) / (max - min || 1)) * (SPARK_H - 6),
  ]);
  const solid = inProgress ? pts.slice(0, -1) : pts;
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg className="analysis-spark" width={SPARK_W} height={SPARK_H} aria-hidden="true">
      {solid.length > 1 && <polyline points={solid.map((p) => p.join(',')).join(' ')} />}
      {inProgress && (
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
 * 每個分類：本月金額、跟平常比的變化、近幾個月的小走勢線。旅程不列在這裡（不拆進各分類），看旅程卡片。
 * 排序與結論句同一個標準（多花的金額），預設只顯示前幾名。
 */
export default function CategoryChanges({ analysis, onSelectCategory }) {
  const { t } = useLanguage();
  const { formatTotal } = useDisplayAmount();
  const [expanded, setExpanded] = useState(false);
  const { categories, baseline, isCurrent } = analysis;
  const rows = expanded ? categories : categories.slice(0, COLLAPSED_COUNT);

  const subline = (cat) => {
    if (cat.risingMonths >= 2) {
      // 這個月還沒過完不算進去，看這個月時寫明是數到上個月
      const key = isCurrent ? 'spendingAnalysis.categories.risingToLast' : 'spendingAnalysis.categories.rising';
      return <span className="analysis-cat__sub is-alert">{t(key, { count: cat.risingMonths })}</span>;
    }
    if (baseline == null) return null;
    if (!cat.usual) return <span className="analysis-cat__sub">{t('spendingAnalysis.categories.new')}</span>;
    return <span className="analysis-cat__sub">{t('spendingAnalysis.categories.usual', { amount: formatTotal(cat.usual) })}</span>;
  };

  return (
    <section className={`analysis-card analysis-cats${expanded ? ' is-expanded' : ''}`}>
      <h3 className="analysis-card__title">
        {t('spendingAnalysis.categories.title')}
        <InfoTip>{t('spendingAnalysis.categories.subtitle')}</InfoTip>
      </h3>
      {categories.length === 0 ? (
        <p className="analysis-empty">{t('spendingAnalysis.categories.empty')}</p>
      ) : (
        <ul className="analysis-cat-list">
          {rows.map((cat) => {
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
                  <Sparkline values={cat.series} inProgress={isCurrent} />
                  {/* 一律顯示實際花的，跟點進去的明細加起來一樣；百分比直接跟平常整個月比 */}
                  <span className="analysis-cat__amount">{formatTotal(cat.current)}</span>
                  <ChangePill ratio={cat.ratio} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {categories.length > COLLAPSED_COUNT && (
        <button type="button" className="analysis-link" onClick={() => setExpanded((v) => !v)}>
          {expanded
            ? t('spendingAnalysis.categories.showLess')
            : t('spendingAnalysis.categories.showAll', { count: categories.length })}
        </button>
      )}
    </section>
  );
}
