import { useState, useMemo, useCallback, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useWindowSize } from '@/hooks/useWindowSize';
import { useTransactionYearRange } from '@/hooks/useTransactionYearRange';
import { useTransactionMonthsInYear } from '@/hooks/useTransactionMonthsInYear';
import { useSpendingAnalysis } from '@/hooks/useSpendingAnalysis';
import { useTrips } from '@/hooks/useTrips';
import { RANGE_FETCH_LIMIT } from '@/hooks/useTransactionSearch';
import { DisplayAmountProvider, useDisplayAmount } from '@/contexts/DisplayAmountContext';
import { buildSpendingAnalysis, EARLY_MONTH_DAYS } from '@/lib/spendingAnalysis';
import { buildTripIndex, summarizeTrips, suggestTrips } from '@/lib/trips';
import { getTodayYmd } from '@/lib/utils';
import { getCached, setCached } from '@/lib/resourceCache';
import { LAYOUT } from '@/lib/constants';
import zh from '@/locales/zh';
import en from '@/locales/en';
import PeriodPicker from '@/components/dashboard/PeriodPicker';
import CategoryDetailModal from '@/components/dashboard/CategoryDetailModal';
import MonthlyBarsChart from '@/components/spending-analysis/MonthlyBarsChart';
import CategoryChanges, { ChangePill } from '@/components/spending-analysis/CategoryChanges';
import CategoryTrendModal from '@/components/spending-analysis/CategoryTrendModal';
import LargeItemsList from '@/components/spending-analysis/LargeItemsList';
import TripsCard from '@/components/spending-analysis/TripsCard';
import TripDetailModal from '@/components/spending-analysis/TripDetailModal';
import TripFormModal from '@/components/spending-analysis/TripFormModal';

// 切到別頁再回來時，停在原本看的月份
const PERIOD_CACHE_KEY = 'spending-analysis:period';

// 跟平常差不到這個比例，就說「差不多」，不報 2%、3% 這種雜訊
const SAME_AS_USUAL = 0.05;

/** 結論句：多花／少花／差不多，加上主要是哪個分類 */
function headlineText(a, monthName, t) {
  if (!a.hasAnyData) return t('spendingAnalysis.headline.noData');
  if (a.isFuture) return t('spendingAnalysis.headline.future', { month: monthName });
  if (a.isBeforeStart) return t('spendingAnalysis.headline.beforeStart', { month: monthName });
  if (a.isEarly && a.baseline != null) return t('spendingAnalysis.headline.early', { day: EARLY_MONTH_DAYS });
  if (a.ratio == null) return t('spendingAnalysis.headline.noBaseline');
  const tense = a.isCurrent ? 'Current' : 'Past';
  const percent = Math.round(Math.abs(a.ratio) * 100);
  if (Math.abs(a.ratio) < SAME_AS_USUAL) return t(`spendingAnalysis.headline.same${tense}`, { month: monthName });
  if (a.ratio > 0) {
    const top = a.categories.find((c) => c.diff > 0);
    // 旅程平常是 0，整趟都算多花；比最會多花的分類還多，就說主要是這趟旅程
    const trip = a.targetTrips[0];
    const more = t(`spendingAnalysis.headline.more${tense}`, { month: monthName, percent });
    if (trip && (!top || trip.value > top.diff)) return more + t('spendingAnalysis.headline.mainlyTrip', { name: trip.trip.name });
    return more + (top ? t('spendingAnalysis.headline.mainlyMore', { category: top.name }) : '');
  }
  const saved = [...a.categories].filter((c) => c.diff < 0).sort((x, y) => x.diff - y.diff)[0];
  return t(`spendingAnalysis.headline.less${tense}`, { month: monthName, percent })
    + (saved ? t('spendingAnalysis.headline.mainlyLess', { category: saved.name }) : '');
}

function KpiCard({ label, value, pill, sub, notes = [], tone }) {
  return (
    <div className="analysis-kpi">
      <span className="analysis-kpi__label">{label}</span>
      <span className="analysis-kpi__value-row">
        <span className={`analysis-kpi__value${tone ? ` is-${tone}` : ''}`}>{value}</span>
        {pill}
      </span>
      {sub && <span className="analysis-kpi__sub">{sub}</span>}
      {notes.filter(Boolean).map((note) => <span key={note} className="analysis-kpi__note">{note}</span>)}
    </div>
  );
}

function SpendingAnalysisContent() {
  const { user } = useAuth();
  const { t, lang } = useLanguage();
  const toast = useToast();
  const { confirm } = useConfirm();
  const { toDisplay, formatTotal } = useDisplayAmount();
  const [period, setPeriod] = useState(() => {
    const cached = getCached(PERIOD_CACHE_KEY, user?.id);
    if (cached) return cached;
    const now = new Date();
    return { granularity: 'month', year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  useEffect(() => {
    if (user?.id) setCached(PERIOD_CACHE_KEY, user.id, period);
  }, [user?.id, period]);
  const [pickerYear, setPickerYear] = useState(period.year);
  const [detail, setDetail] = useState(null);
  const [trendName, setTrendName] = useState(null);
  const yearRange = useTransactionYearRange(user?.id);
  const monthsWithData = useTransactionMonthsInYear(user?.id, pickerYear);
  const { targetYm, expenses, firstYm, includedIds, loading: analysisLoading, error: analysisError, capped, setLargeItemIncluded } =
    useSpendingAnalysis(user?.id, period.year, period.month);
  const tripsState = useTrips(user?.id);
  const { trips, dismissed, rows: tripRows } = tripsState;
  // 旅程的交易還沒抓回來就先算，會先把旅程當日常支出閃一下
  const loading = analysisLoading || tripsState.loading;
  const error = analysisError || tripsState.error;
  const [tripDetailId, setTripDetailId] = useState(null);
  const [tripForm, setTripForm] = useState(null);

  const monthNames = (lang === 'en' ? en : zh).common.monthsShort;
  const labelOf = useCallback((ym) => monthNames[Number(ym.slice(5, 7)) - 1], [monthNames]);
  const monthName = labelOf(targetYm);
  const periodLabel = t('common.monthYear', { year: period.year, month: monthName });

  // 放在 useMemo 外面：頁面開著跨過午夜，下一次重繪就換成新的日期
  const todayYmd = getTodayYmd();
  const currentYear = Number(todayYmd.slice(0, 4));
  const toValue = useCallback((tx) => toDisplay(tx).value, [toDisplay]);
  const tripIndex = useMemo(() => buildTripIndex(trips, tripRows), [trips, tripRows]);
  const tripSummaries = useMemo(() => summarizeTrips(trips, tripRows, tripIndex, {
    toValue,
    uncategorizedLabel: t('transaction.uncategorized'),
  }), [trips, tripRows, tripIndex, toValue, t]);
  const suggestions = useMemo(() => suggestTrips(expenses, trips, dismissed), [expenses, trips, dismissed]);
  const analysis = useMemo(() => buildSpendingAnalysis({
    expenses,
    targetYm,
    todayYmd,
    firstYm,
    includedIds,
    toValue,
    uncategorizedLabel: t('transaction.uncategorized'),
    tripOf: tripIndex,
  }), [expenses, targetYm, todayYmd, firstYm, includedIds, toValue, t, tripIndex]);

  const handleSelectMonth = useCallback((m) => {
    setDetail({
      kind: 'period',
      label: t('spendingAnalysis.monthDetail', { month: labelOf(m.ym) }),
      value: m.daily,
      txs: m.dailyTxs,
      totalExpense: m.daily,
    });
  }, [labelOf, t]);

  // 點分類看它的走勢放大版；存名稱，資料更新（背景重抓、改大額設定）時跟著換
  const handleSelectCategory = useCallback((cat) => setTrendName(cat.name), []);
  const trendCategory = analysis.categories.find((c) => c.name === trendName) || null;

  const handleToggleLarge = useCallback((txId, include) => {
    setLargeItemIncluded(txId, include).catch(() => toast.error(t('spendingAnalysis.large.saveFailed')));
  }, [setLargeItemIncluded, toast, t]);

  const saveFailed = useCallback(() => toast.error(t('spendingAnalysis.large.saveFailed')), [toast, t]);
  useEffect(() => {
    if (tripsState.refreshError) toast.error(t('spendingAnalysis.trips.refreshFailed'));
  }, [tripsState.refreshError]); // eslint-disable-line react-hooks/exhaustive-deps -- 只在出現新的錯誤時提示一次
  const handleTripEntry = useCallback((tripId, txId, action) => {
    tripsState.setEntry(tripId, txId, action).catch(saveFailed);
  }, [tripsState, saveFailed]);
  // 編輯表單從明細開啟時，先把明細收起來（兩個彈窗疊著，按 Esc 會一起關、背景也會變成可以捲動），
  // 表單關掉或存好再回到明細
  const closeTripForm = useCallback(() => {
    if (tripForm?.returnTo) setTripDetailId(tripForm.returnTo);
    setTripForm(null);
  }, [tripForm]);
  const handleSaveTrip = useCallback(async (values) => {
    if (tripForm?.mode === 'edit') {
      await tripsState.editTrip(tripForm.tripId, values);
      setTripDetailId(tripForm.tripId);
    } else {
      const trip = await tripsState.createTrip(values);
      setTripDetailId(trip.id);
    }
    setTripForm(null);
  }, [tripForm, tripsState]);
  const handleDeleteTrip = useCallback(async (trip) => {
    const ok = await confirm(t('spendingAnalysis.tripDetail.deleteConfirm', { name: trip.name }), { danger: true });
    if (!ok) return;
    setTripDetailId(null);
    tripsState.deleteTrip(trip.id).catch(saveFailed);
  }, [confirm, t, tripsState, saveFailed]);
  const handleDismissSuggestion = useCallback((s) => {
    tripsState.dismissSuggestion(s.key).catch(saveFailed);
  }, [tripsState, saveFailed]);
  const tripDetail = tripSummaries.find((s) => s.trip.id === tripDetailId) || null;

  const a = analysis;
  const tripTotal = a.targetTrips.reduce((sum, row) => sum + row.value, 0);
  const tripNote = a.targetTrips.length === 1
    ? t('spendingAnalysis.kpi.tripNote', { name: a.targetTrips[0].trip.name, amount: formatTotal(tripTotal) })
    : a.targetTrips.length > 1
      ? t('spendingAnalysis.kpi.tripsNote', { amount: formatTotal(tripTotal), names: a.targetTrips.map((row) => row.trip.name).join(lang === 'en' ? ', ' : '、') })
      : null;
  const [, monthNum] = targetYm.split('-').map(Number);
  const showBody = !loading && !error && a.hasAnyData && !a.isFuture && !a.isBeforeStart;
  // 這個月還沒過完：結論、分類都跟「平常同期」比（月初還不比，照樣顯示整個月的平常）
  const toDateCompare = a.isCurrent && !a.isEarly && a.baseline != null;
  // 有大額單筆改成算進分析：說明改說「不含另外列的」，這個月的卡片也寫出算進去多少
  const largeWord = t(a.largeItems.some((item) => item.included) ? 'spendingAnalysis.largeWordSome' : 'spendingAnalysis.largeWord');
  const includedLarge = a.largeItems
    .filter((item) => item.included && item.tx.date.startsWith(targetYm))
    .reduce((sum, item) => sum + item.value, 0);

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
              {toDateCompare
                ? t(trips.length ? 'spendingAnalysis.headline.noteToDateTrips' : 'spendingAnalysis.headline.noteToDate', { count: a.baselineMonths.length, day: a.daysElapsed, large: largeWord })
                : t(trips.length ? 'spendingAnalysis.headline.noteTrips' : 'spendingAnalysis.headline.note', { count: a.baselineMonths.length, large: largeWord })}
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
              // 跟旁邊那張（平常同期／平常）比，跟分類清單同一個標記
              pill={a.ratio != null && <ChangePill ratio={a.ratio} />}
              sub={`${monthNum}/1 – ${monthNum}/${a.daysElapsed}`}
              notes={[
                tripNote,
                includedLarge > 0 ? t('spendingAnalysis.kpi.largeIncludedNote', { amount: formatTotal(includedLarge) }) : null,
                a.targetLarge > 0 ? t('spendingAnalysis.kpi.largeNote', { amount: formatTotal(a.targetLarge) }) : null,
              ]}
            />
            {toDateCompare ? (
              <KpiCard
                label={t('spendingAnalysis.kpi.baselineToDate')}
                value={formatTotal(a.baselineToDate)}
                sub={t(trips.length ? 'spendingAnalysis.kpi.baselineToDateSubTrips' : 'spendingAnalysis.kpi.baselineToDateSub', {
                  count: a.baselineMonths.length,
                  day: a.daysElapsed,
                })}
                notes={[t('spendingAnalysis.kpi.baselineMonthNote', { amount: formatTotal(a.baseline) })]}
              />
            ) : (
              <KpiCard
                label={t('spendingAnalysis.kpi.baseline')}
                value={a.baseline == null ? '—' : formatTotal(a.baseline)}
                sub={a.baseline == null
                  ? t('spendingAnalysis.kpi.baselineNone')
                  : t(trips.length ? 'spendingAnalysis.kpi.baselineSubTrips' : 'spendingAnalysis.kpi.baselineSub', { count: a.baselineMonths.length })}
              />
            )}
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
                sub={a.daysElapsed < a.daysInMonth
                  ? t('spendingAnalysis.kpi.projectedSub', { from: a.daysElapsed + 1, to: a.daysInMonth })
                  : t('spendingAnalysis.kpi.projectedSubLast')}
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
            <CategoryChanges analysis={a} currentYear={currentYear} onSelectCategory={handleSelectCategory} onSelectTrip={setTripDetailId} />
          </div>

          <TripsCard
            summaries={tripSummaries}
            suggestions={suggestions}
            currentYear={currentYear}
            onCreate={() => setTripForm({ mode: 'create' })}
            onAcceptSuggestion={(s) => setTripForm({ mode: 'create', start: s.start, end: s.end, fromSuggestion: true })}
            onDismissSuggestion={handleDismissSuggestion}
            onSelect={setTripDetailId}
          />

          {a.largeItems.length > 0 && <LargeItemsList items={a.largeItems} onToggle={handleToggleLarge} />}
        </>
      )}

      <TripDetailModal
        userId={user?.id}
        summary={tripDetail}
        tripOf={tripIndex}
        currentYear={currentYear}
        onClose={() => setTripDetailId(null)}
        onEntry={handleTripEntry}
        onEdit={(trip) => {
          setTripDetailId(null);
          setTripForm({ mode: 'edit', tripId: trip.id, name: trip.name, start: trip.start, end: trip.end, returnTo: trip.id });
        }}
        onDelete={handleDeleteTrip}
      />
      <TripFormModal form={tripForm} onClose={closeTripForm} onSave={handleSaveTrip} />

      <CategoryTrendModal
        category={trendCategory}
        analysis={analysis}
        labelOf={labelOf}
        onClose={() => setTrendName(null)}
      />
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
