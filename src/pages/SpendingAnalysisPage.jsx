import { useState, useMemo, useCallback, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useWindowSize } from '@/hooks/useWindowSize';
import { useTransactionYearRange } from '@/hooks/useTransactionYearRange';
import { useTransactionMonthsInYear } from '@/hooks/useTransactionMonthsInYear';
import { useSpendingAnalysis, ANALYSIS_FETCH_LIMIT } from '@/hooks/useSpendingAnalysis';
import { useTrips } from '@/hooks/useTrips';
import { DisplayAmountProvider, useDisplayAmount } from '@/contexts/DisplayAmountContext';
import { useRateTables } from '@/hooks/useDisplayRates';
import {
  buildSpendingAnalysis,
  addMonths,
  ymOf,
  largeMeasure,
  thresholdFromInput,
  thresholdForDisplay,
  baselineStartOf,
  EARLY_MONTH_DAYS,
  FIXED_ITEM_RULE,
} from '@/lib/spendingAnalysis';
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
import InfoTip from '@/components/spending-analysis/InfoTip';
import AnalysisStartForm from '@/components/spending-analysis/AnalysisStartForm';

// 切到別頁再回來時，停在原本看的月份
const PERIOD_CACHE_KEY = 'spending-analysis:period';

const ChevronLeft = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
  </svg>
);

const ChevronRight = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
  </svg>
);

const SettingsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
  </svg>
);

// 跟平常差不到這個比例，就說「差不多」，不報 2%、3% 這種雜訊
const SAME_AS_USUAL = 0.05;

/** 結論句：多花／少花／差不多，加上主要是哪個分類 */
function headlineText(a, monthName, startName, t) {
  if (!a.hasAnyData) return t('spendingAnalysis.headline.noData');
  if (a.isFuture) return t('spendingAnalysis.headline.future', { month: monthName });
  if (a.isBeforeRecords) return t('spendingAnalysis.headline.beforeStart', { month: monthName });
  if (a.isBeforeStart) return t('spendingAnalysis.headline.beforeAnalysis', { month: monthName, start: startName });
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
    // 平常幾個月也有旅行時，只看這趟比平常多出來的部分
    if (trip && a.tripExtra > 0 && (!top || a.tripExtra > top.diff)) return more + t('spendingAnalysis.headline.mainlyTrip', { name: trip.trip.name });
    return more + (top ? t('spendingAnalysis.headline.mainlyMore', { category: top.name }) : '');
  }
  const saved = [...a.categories].filter((c) => c.diff < 0).sort((x, y) => x.diff - y.diff)[0];
  return t(`spendingAnalysis.headline.less${tense}`, { month: monthName, percent })
    + (saved ? t('spendingAnalysis.headline.mainlyLess', { category: saved.name }) : '');
}

/**
 * info：這張卡怎麼算的，收在標題旁的小 i；sub、notes 是畫面上直接顯示的日期與金額。
 * action 是標題列右邊的按鈕，children 放在卡片最下面（例如改設定的小框）
 */
function KpiCard({ label, info, value, pill, sub, notes = [], tone, action, children }) {
  return (
    <div className="analysis-kpi">
      <div className="analysis-kpi__head">
        <span className="analysis-kpi__label">
          {label}
          {info && <InfoTip>{info}</InfoTip>}
        </span>
        {action}
      </div>
      <span className="analysis-kpi__value-row">
        <span className={`analysis-kpi__value${tone ? ` is-${tone}` : ''}`}>{value}</span>
        {pill}
      </span>
      {sub && <span className="analysis-kpi__sub">{sub}</span>}
      {notes.filter(Boolean).map((note) => <span key={note} className="analysis-kpi__note">{note}</span>)}
      {children}
    </div>
  );
}

function SpendingAnalysisContent() {
  const { user } = useAuth();
  const { t, lang } = useLanguage();
  const toast = useToast();
  const { confirm } = useConfirm();
  const { toDisplay, formatTotal, currency } = useDisplayAmount();
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
  const {
    targetYm, expenses, firstYm, threshold, startYm, chartSpan, coveredFromYm,
    loading: analysisLoading, error: analysisError, savePref,
  } = useSpendingAnalysis(user?.id, period.year, period.month);
  const [editingStart, setEditingStart] = useState(false);
  // 門檻幣別（比大額用）與顯示幣別（改門檻時換算用）的匯率表；跟顯示幣別共用快取，不會重抓
  const rateTables = useRateTables([threshold.currency, currency]);
  const thresholdTable = rateTables[threshold.currency] ?? null;
  const displayTable = rateTables[currency] ?? null;
  const measure = useMemo(() => largeMeasure(threshold, thresholdTable), [threshold, thresholdTable]);
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
  const labelOfYm = useCallback((ym) => t('common.monthYear', { year: ym.slice(0, 4), month: labelOf(ym) }), [labelOf, t]);
  // 跟正在看的月份同一年就不寫年份：「1月起」「2025年11月起」
  const shortLabelOfYm = (ym) => (ym.slice(0, 4) === targetYm.slice(0, 4) ? labelOf(ym) : labelOfYm(ym));

  // 放在 useMemo 外面：頁面開著跨過午夜，下一次重繪就換成新的日期
  const todayYmd = getTodayYmd();
  const currentYear = Number(todayYmd.slice(0, 4));
  const toValue = useCallback((tx) => toDisplay(tx).value, [toDisplay]);
  const tripIndex = useMemo(() => buildTripIndex(trips, tripRows), [trips, tripRows]);
  const tripSummaries = useMemo(() => summarizeTrips(trips, tripRows, tripIndex, {
    toValue,
    uncategorizedLabel: t('transaction.uncategorized'),
  }), [trips, tripRows, tripIndex, toValue, t]);
  // 旅程建議只看正在看的月份前後一段（跟以前一次只讀這段時一樣），起點設很早也不會冒出一堆舊旅程
  const suggestions = useMemo(() => {
    const from = addMonths(targetYm, -5 - FIXED_ITEM_RULE.withinMonths);
    const to = addMonths(targetYm, FIXED_ITEM_RULE.withinMonths);
    const nearby = expenses.filter((tx) => ymOf(tx.date) >= from && ymOf(tx.date) <= to);
    return suggestTrips(nearby, trips, dismissed);
  }, [expenses, targetYm, trips, dismissed]);
  // 交易太多只讀到一部分時，從讀完整的那個月起算平常
  const effectiveStartYm = coveredFromYm && coveredFromYm > baselineStartOf(firstYm, startYm) ? coveredFromYm : startYm;
  const analysis = useMemo(() => buildSpendingAnalysis({
    expenses,
    targetYm,
    todayYmd,
    firstYm,
    startYm: effectiveStartYm,
    chartSpan,
    measure,
    toValue,
    uncategorizedLabel: t('transaction.uncategorized'),
    tripOf: tripIndex,
  }), [expenses, targetYm, todayYmd, firstYm, effectiveStartYm, chartSpan, measure, toValue, t, tripIndex]);

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

  const saveFailed = useCallback(() => toast.error(t('spendingAnalysis.large.saveFailed')), [toast, t]);
  // 門檻用正在顯示的幣別輸入；外幣同時用今天的匯率換一份台幣存著。
  // 畫面當下就換成新門檻、雲端在背景存，存失敗會退回原本的門檻並跳提示。匯率讀不到就不存，回傳訊息給表單顯示
  const handleSaveThreshold = useCallback((amount) => {
    const next = thresholdFromInput(amount, currency, displayTable);
    if (!next) return t('spendingAnalysis.large.thresholdNoRate', { currency });
    savePref('threshold', next).catch(saveFailed);
    return null;
  }, [currency, displayTable, savePref, saveFailed, t]);
  // 起點、長條圖月數也一樣：畫面先換，存失敗才退回並提示
  const handleSaveStart = useCallback((next) => {
    setEditingStart(false);
    savePref('startYm', next).catch(saveFailed);
  }, [savePref, saveFailed]);
  const handleChangeSpan = useCallback((next) => {
    savePref('chartSpan', next).catch(saveFailed);
  }, [savePref, saveFailed]);

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
  // 月份箭頭：往前到分析起點、往後到這個月為止（再過去只會顯示「還沒開始」）。
  // 讀資料時照樣能點，連續點會直接跳到最後點的那個月
  const canPrev = !!a.analysisStartYm && targetYm > a.analysisStartYm;
  const canNext = targetYm < ymOf(todayYmd);
  const shiftMonth = (n) => {
    const [y, m] = addMonths(targetYm, n).split('-').map(Number);
    setPeriod({ granularity: 'month', year: y, month: m });
  };
  const showBody = !loading && !error && a.hasAnyData && !a.isFuture && !a.isBeforeStart;
  // 這個月還沒過完：結論、分類都跟「平常同期」比（月初還不比，照樣顯示整個月的平常）
  const toDateCompare = a.isCurrent && !a.isEarly && a.baseline != null;
  // 大額單筆照樣算在金額裡，卡片上只提一句有幾筆
  const largeNote = a.largeItems.length > 0
    ? t(a.isCurrent ? 'spendingAnalysis.kpi.largeCount' : 'spendingAnalysis.kpi.largeCountPast', {
      month: monthName,
      count: a.largeItems.length,
      amount: formatTotal(a.largeTotal),
    })
    : null;
  // 平常從哪個月起算（baselineMonths 是新 → 舊）
  const since = a.baselineMonths.length ? shortLabelOfYm(a.baselineMonths[a.baselineMonths.length - 1]) : '';
  // 「平常」卡片標題旁改分析起點的按鈕與小框
  const startButton = (
    <button
      type="button"
      className="analysis-icon-btn"
      aria-label={t('spendingAnalysis.start.set')}
      title={t('spendingAnalysis.start.set')}
      aria-expanded={editingStart}
      onClick={() => setEditingStart((v) => !v)}
    >
      <SettingsIcon />
    </button>
  );
  const startForm = editingStart && firstYm && (
    <AnalysisStartForm
      startYm={startYm}
      firstYm={firstYm}
      currentYm={ymOf(todayYmd)}
      labelOfYm={labelOfYm}
      onSave={handleSaveStart}
      onCancel={() => setEditingStart(false)}
    />
  );

  return (
    <div className="analysis-page">
      <header className="analysis-page__header">
        <h2>{t('spendingAnalysis.title')}</h2>
        <div className="analysis-month-nav">
          <button
            type="button"
            className="analysis-icon-btn"
            aria-label={t('spendingAnalysis.prevMonth')}
            title={t('spendingAnalysis.prevMonth')}
            disabled={!canPrev}
            onClick={() => shiftMonth(-1)}
          >
            <ChevronLeft />
          </button>
          <PeriodPicker
            period={period}
            onChange={setPeriod}
            yearRange={yearRange}
            monthsWithData={monthsWithData}
            onDisplayYearChange={setPickerYear}
            disabled={loading}
          />
          <button
            type="button"
            className="analysis-icon-btn"
            aria-label={t('spendingAnalysis.nextMonth')}
            title={t('spendingAnalysis.nextMonth')}
            disabled={!canNext}
            onClick={() => shiftMonth(1)}
          >
            <ChevronRight />
          </button>
        </div>
      </header>

      {loading ? (
        <p className="analysis-status">{t('common.loading')}</p>
      ) : error ? (
        <p className="analysis-status">{t('spendingAnalysis.loadFailed')}</p>
      ) : (
        <section className="analysis-card analysis-headline">
          <p className="analysis-headline__text">
            {headlineText(a, monthName, a.analysisStartYm && labelOfYm(a.analysisStartYm), t)}
            {/* 「平常」怎麼算的收在小 i 裡，畫面上只留結論 */}
            {showBody && a.baseline != null && (
              <InfoTip>
                {toDateCompare
                  ? t('spendingAnalysis.headline.noteToDate', { since, count: a.baselineMonths.length, day: a.daysElapsed })
                  : t('spendingAnalysis.headline.note', { since, count: a.baselineMonths.length })}
              </InfoTip>
            )}
          </p>
          {showBody && coveredFromYm && (
            <p className="analysis-headline__note">
              {t('spendingAnalysis.capped', { limit: ANALYSIS_FETCH_LIMIT.toLocaleString(), month: labelOfYm(coveredFromYm) })}
            </p>
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
              notes={[tripNote, largeNote]}
            />
            {toDateCompare ? (
              <KpiCard
                label={t('spendingAnalysis.kpi.baselineToDate')}
                value={formatTotal(a.baselineToDate)}
                info={t('spendingAnalysis.kpi.baselineToDateSub', {
                  since,
                  count: a.baselineMonths.length,
                  day: a.daysElapsed,
                })}
                notes={[t('spendingAnalysis.kpi.baselineMonthNote', { amount: formatTotal(a.baseline) })]}
                action={startButton}
              >
                {startForm}
              </KpiCard>
            ) : (
              <KpiCard
                label={t('spendingAnalysis.kpi.baseline')}
                value={a.baseline == null ? '—' : formatTotal(a.baseline)}
                info={a.baseline != null
                  && t('spendingAnalysis.kpi.baselineSub', { since, count: a.baselineMonths.length })}
                sub={a.baseline == null ? t('spendingAnalysis.kpi.baselineNone') : null}
                action={startButton}
              >
                {startForm}
              </KpiCard>
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
                info={a.daysElapsed < a.daysInMonth
                  ? t('spendingAnalysis.kpi.projectedSub', { from: a.daysElapsed + 1, to: a.daysInMonth })
                  : t('spendingAnalysis.kpi.projectedSubLast')}
                tone={a.ratio != null && a.ratio >= SAME_AS_USUAL ? 'up' : null}
              />
            ) : (
              <KpiCard
                label={t('spendingAnalysis.kpi.vsBaseline')}
                value={a.baseline == null ? '—' : formatTotal(a.projected - a.baseline, { prefix: a.projected >= a.baseline ? '+' : '' })}
                info={t('spendingAnalysis.kpi.vsBaselineSub')}
                tone={a.ratio != null && a.ratio >= SAME_AS_USUAL ? 'up' : null}
              />
            )}
          </div>

          <div className="analysis-grid">
            <MonthlyBarsChart
              analysis={a}
              labelOf={labelOf}
              onSelectMonth={handleSelectMonth}
              span={chartSpan}
              onChangeSpan={handleChangeSpan}
            />
            <CategoryChanges analysis={a} onSelectCategory={handleSelectCategory} />
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

          {/* 沒有大額單筆的月份也顯示，改門檻的按鈕才一直找得到 */}
          <LargeItemsList
            items={a.largeItems}
            threshold={threshold}
            shown={thresholdForDisplay(threshold, currency, thresholdTable, displayTable)}
            onSaveThreshold={handleSaveThreshold}
          />
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
