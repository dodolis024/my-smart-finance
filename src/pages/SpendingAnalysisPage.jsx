import { useState, useMemo, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/contexts/ToastContext';
import { useWindowSize } from '@/hooks/useWindowSize';
import { useTransactionYearRange } from '@/hooks/useTransactionYearRange';
import { useTransactionMonthsInYear } from '@/hooks/useTransactionMonthsInYear';
import { useSpendingAnalysis } from '@/hooks/useSpendingAnalysis';
import { RANGE_FETCH_LIMIT } from '@/hooks/useTransactionSearch';
import { DisplayAmountProvider, useDisplayAmount } from '@/contexts/DisplayAmountContext';
import { buildSpendingAnalysis, EARLY_MONTH_DAYS } from '@/lib/spendingAnalysis';
import { getTodayYmd } from '@/lib/utils';
import { LAYOUT } from '@/lib/constants';
import zh from '@/locales/zh';
import en from '@/locales/en';
import PeriodPicker from '@/components/dashboard/PeriodPicker';
import CategoryDetailModal from '@/components/dashboard/CategoryDetailModal';
import MonthlyBarsChart from '@/components/spending-analysis/MonthlyBarsChart';
import CategoryChanges from '@/components/spending-analysis/CategoryChanges';
import LargeItemsList from '@/components/spending-analysis/LargeItemsList';

// 跟平常差不到這個比例，就說「差不多」，不報 2%、3% 這種雜訊
const SAME_AS_USUAL = 0.05;

/** 結論句：多花／少花／差不多，加上主要是哪個分類 */
function headlineText(a, monthName, t) {
  if (!a.hasAnyData) return t('spendingAnalysis.headline.noData');
  if (a.isFuture) return t('spendingAnalysis.headline.future', { month: monthName });
  if (a.isEarly && a.baseline != null) return t('spendingAnalysis.headline.early', { day: EARLY_MONTH_DAYS });
  if (a.ratio == null) return t('spendingAnalysis.headline.noBaseline');
  const tense = a.isCurrent ? 'Current' : 'Past';
  const percent = Math.round(Math.abs(a.ratio) * 100);
  if (Math.abs(a.ratio) < SAME_AS_USUAL) return t(`spendingAnalysis.headline.same${tense}`, { month: monthName });
  if (a.ratio > 0) {
    const top = a.categories.find((c) => c.diff > 0);
    return t(`spendingAnalysis.headline.more${tense}`, { month: monthName, percent })
      + (top ? t('spendingAnalysis.headline.mainlyMore', { category: top.name }) : '');
  }
  const saved = [...a.categories].filter((c) => c.diff < 0).sort((x, y) => x.diff - y.diff)[0];
  return t(`spendingAnalysis.headline.less${tense}`, { month: monthName, percent })
    + (saved ? t('spendingAnalysis.headline.mainlyLess', { category: saved.name }) : '');
}

function KpiCard({ label, value, sub, note, tone }) {
  return (
    <div className="analysis-kpi">
      <span className="analysis-kpi__label">{label}</span>
      <span className={`analysis-kpi__value${tone ? ` is-${tone}` : ''}`}>{value}</span>
      {sub && <span className="analysis-kpi__sub">{sub}</span>}
      {note && <span className="analysis-kpi__note">{note}</span>}
    </div>
  );
}

function SpendingAnalysisContent() {
  const { user } = useAuth();
  const { t, lang } = useLanguage();
  const toast = useToast();
  const { toDisplay, formatTotal } = useDisplayAmount();
  const [period, setPeriod] = useState(() => {
    const now = new Date();
    return { granularity: 'month', year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const [pickerYear, setPickerYear] = useState(period.year);
  const [detail, setDetail] = useState(null);
  const yearRange = useTransactionYearRange(user?.id);
  const monthsWithData = useTransactionMonthsInYear(user?.id, pickerYear);
  const { targetYm, expenses, firstYm, includedIds, loading, error, capped, setLargeItemIncluded } =
    useSpendingAnalysis(user?.id, period.year, period.month);

  const monthNames = (lang === 'en' ? en : zh).common.monthsShort;
  const labelOf = useCallback((ym) => monthNames[Number(ym.slice(5, 7)) - 1], [monthNames]);
  const monthName = labelOf(targetYm);
  const periodLabel = t('common.monthYear', { year: period.year, month: monthName });

  // 放在 useMemo 外面：頁面開著跨過午夜，下一次重繪就換成新的日期
  const todayYmd = getTodayYmd();
  const analysis = useMemo(() => buildSpendingAnalysis({
    expenses,
    targetYm,
    todayYmd,
    firstYm,
    includedIds,
    toValue: (tx) => toDisplay(tx).value,
    uncategorizedLabel: t('transaction.uncategorized'),
  }), [expenses, targetYm, todayYmd, firstYm, includedIds, toDisplay, t]);

  const handleSelectMonth = useCallback((m) => {
    setDetail({
      kind: 'period',
      label: t('spendingAnalysis.monthDetail', { month: labelOf(m.ym) }),
      value: m.daily,
      txs: m.dailyTxs,
      totalExpense: m.daily,
    });
  }, [labelOf, t]);

  const handleSelectCategory = useCallback((cat) => {
    setDetail({ label: cat.name, value: cat.current, txs: cat.txs, totalExpense: analysis.toDate });
  }, [analysis.toDate]);

  const handleToggleLarge = useCallback((txId, include) => {
    setLargeItemIncluded(txId, include).catch(() => toast.error(t('spendingAnalysis.large.saveFailed')));
  }, [setLargeItemIncluded, toast, t]);

  const a = analysis;
  const [, monthNum] = targetYm.split('-').map(Number);
  const showBody = !loading && !error && a.hasAnyData && !a.isFuture;

  return (
    <div className="analysis-page">
      <header className="analysis-page__header">
        <h2>{t('spendingAnalysis.title')}</h2>
        <PeriodPicker
          period={period}
          onChange={setPeriod}
          yearRange={yearRange}
          monthsWithData={monthsWithData}
          onDisplayYearChange={setPickerYear}
          disabled={loading}
        />
      </header>

      {loading ? (
        <p className="analysis-status">{t('common.loading')}</p>
      ) : error ? (
        <p className="analysis-status">{t('spendingAnalysis.loadFailed')}</p>
      ) : (
        <section className="analysis-card analysis-headline">
          <p className="analysis-headline__text">{headlineText(a, monthName, t)}</p>
          {showBody && a.baseline != null && (
            <p className="analysis-headline__note">
              {t('spendingAnalysis.headline.note', { count: a.baselineMonths.length })}
              {' · '}
              {t('spendingAnalysis.headline.clickHint')}
            </p>
          )}
          {showBody && capped && (
            <p className="analysis-headline__note">{t('spendingAnalysis.capped', { limit: RANGE_FETCH_LIMIT })}</p>
          )}
        </section>
      )}

      {showBody && (
        <>
          <div className="analysis-kpis">
            <KpiCard
              label={a.isCurrent ? t('spendingAnalysis.kpi.toDate') : t('spendingAnalysis.kpi.monthTotal', { month: monthName })}
              value={formatTotal(a.toDate)}
              sub={`${monthNum}/1 – ${monthNum}/${a.daysElapsed}`}
              note={a.targetLarge > 0 ? t('spendingAnalysis.kpi.largeNote', { amount: formatTotal(a.targetLarge) }) : null}
            />
            <KpiCard
              label={t('spendingAnalysis.kpi.baseline')}
              value={a.baseline == null ? '—' : formatTotal(a.baseline)}
              sub={a.baseline == null
                ? t('spendingAnalysis.kpi.baselineNone')
                : t('spendingAnalysis.kpi.baselineSub', { count: a.baselineMonths.length })}
            />
            {a.isEarly ? (
              <KpiCard
                label={t('spendingAnalysis.kpi.projected')}
                value="—"
                sub={t('spendingAnalysis.kpi.projectedEarly', { day: EARLY_MONTH_DAYS })}
              />
            ) : a.isCurrent ? (
              <KpiCard
                label={t('spendingAnalysis.kpi.projected')}
                value={formatTotal(a.projected)}
                sub={t('spendingAnalysis.kpi.projectedSub')}
                note={a.pendingFixed.length > 0 ? t('spendingAnalysis.kpi.pendingFixed', {
                  amount: formatTotal(a.pendingFixed.reduce((sum, p) => sum + p.value, 0)),
                  items: a.pendingFixed.map((p) => p.tx.itemName).join(lang === 'en' ? ', ' : '、'),
                }) : null}
                tone={a.ratio != null && a.ratio >= SAME_AS_USUAL ? 'up' : null}
              />
            ) : (
              <KpiCard
                label={t('spendingAnalysis.kpi.vsBaseline')}
                value={a.baseline == null ? '—' : formatTotal(a.projected - a.baseline, { prefix: a.projected >= a.baseline ? '+' : '' })}
                sub={t('spendingAnalysis.kpi.vsBaselineSub')}
                tone={a.ratio != null && a.ratio >= SAME_AS_USUAL ? 'up' : null}
              />
            )}
          </div>

          <div className="analysis-grid">
            <MonthlyBarsChart analysis={a} labelOf={labelOf} onSelectMonth={handleSelectMonth} />
            <CategoryChanges analysis={a} onSelectCategory={handleSelectCategory} />
          </div>

          {a.largeItems.length > 0 && <LargeItemsList items={a.largeItems} onToggle={handleToggleLarge} />}
        </>
      )}

      <CategoryDetailModal
        isOpen={!!detail}
        onClose={() => setDetail(null)}
        category={detail}
        periodName={periodLabel}
      />
    </div>
  );
}

/** 只在電腦版（有側欄的寬度）開放；手機或窄視窗直接開網址就導回首頁 */
export default function SpendingAnalysisPage() {
  const { width } = useWindowSize();
  if (width < LAYOUT.SIDEBAR_MIN_WIDTH) return <Navigate to="/" replace />;
  return (
    <DisplayAmountProvider>
      <SpendingAnalysisContent />
    </DisplayAmountProvider>
  );
}
