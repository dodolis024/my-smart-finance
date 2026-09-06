import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useDashboard } from '@/hooks/useDashboard';
import { useStreak } from '@/hooks/useStreak';
import { useTransactions } from '@/hooks/useTransactions';
import { useOfflineMergedView } from '@/hooks/useOfflineMergedView';
import { useCreditCardNotifications } from '@/hooks/useCreditCardNotifications';
import { useModalStates } from '@/hooks/useModalStates';
import { useTransactionSearch, fetchTransactionMatches, fetchTransactionsByDateRange, sumTransactions, SEARCH_LIMIT, RANGE_FETCH_LIMIT } from '@/hooks/useTransactionSearch';
import { useTransactionYearRange } from '@/hooks/useTransactionYearRange';
import { useTransactionMonthsInYear, invalidateTransactionMonths } from '@/hooks/useTransactionMonthsInYear';
import { useWindowSize } from '@/hooks/useWindowSize';
import { useTheme } from '@/hooks/useTheme';
import { supabase } from '@/lib/supabase';
import { getPeriodRange, getPeriodFileLabel, getPeriodNameKey } from '@/lib/period';
import { isOfflineError } from '@/lib/offlineCache';
import { buildTransactionsCsv, downloadCsv } from '@/lib/csvExport';
import { subscribeDataChanged } from '@/lib/dataEvents';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useLanguage } from '@/contexts/LanguageContext';
import TopBar from '@/components/layout/TopBar';
import FormColumn from '@/components/layout/FormColumn';
import DashboardColumn from '@/components/layout/DashboardColumn';
import StatCards from '@/components/dashboard/StatCards';
import PeriodPicker from '@/components/dashboard/PeriodPicker';
import ExportMenu from '@/components/dashboard/ExportMenu';
import ExportRangeModal from '@/components/dashboard/ExportRangeModal';
import AccountBalanceModal from '@/components/common/AccountBalanceModal';
import CategoryChart from '@/components/dashboard/CategoryChart';
import CategoryDetailModal from '@/components/dashboard/CategoryDetailModal';
import PaymentStats from '@/components/dashboard/PaymentStats';
import TransactionForm from '@/components/transactions/TransactionForm';
import TransactionTable from '@/components/transactions/TransactionTable';
import FilterPopover from '@/components/transactions/FilterPopover';
import { useTransactionFilters } from '@/hooks/useTransactionFilters';
import { getChartPalette, buildCategoryColorMap } from '@/lib/categoryColor';
import CreditCardModal from '@/components/common/CreditCardModal';
import StreakBadge from '@/components/streak/StreakBadge';
import StreakModal from '@/components/streak/StreakModal';
import YearlyReviewBanner from '@/components/dashboard/YearlyReviewBanner';

// 交易紀錄每頁筆數：約 3 個手機螢幕，是可以一頁看完的單位
const PAGE_SIZE = 50;
// 外顯切換器只在夠寬的視窗出現。門檻取自實測：768px 以下、離線徽章與待同步藥丸
// 同時在時，收支概覽那一列會被擠到換行；768px 起四種組合都維持單列
const GRANULARITY_TOGGLE_MIN_WIDTH = 768;
// 粒度記在本機，重整後保留；錨點刻意不記（重整代表「重新開始看」）
const GRANULARITY_KEY = 'dashboard-granularity';
const readGranularity = () => {
  try {
    return localStorage.getItem(GRANULARITY_KEY) === 'year' ? 'year' : 'month';
  } catch {
    return 'month';
  }
};

export default function DashboardPage() {
  const { user, ensureDefaultDataForOAuth } = useAuth();
  const {
    dashboardData,
    transactionHistoryFull,
    creditHistory,
    fetchCreditHistory,
    balanceHistory,
    fetchBalanceHistory,
    updateAccountBalance,
    summary,
    accounts,
    categoriesExpense,
    categoriesIncome,
    currencies,
    defaultCurrency,
    loading,
    offlineSnapshot,
    fetchDashboardData,
    fetchCurrencies,
    removeTransactionLocally,
  } = useDashboard();
  const {
    streakState,
    streakInitialHandled,
    setStreakInitialHandled,
    updateStreakFromServer,
    hasCheckinToday,
    submitDailyCheckin,
    shouldShowBrokenModal,
    shouldShowPositiveModal,
    getPositiveModalContent,
    getCurrentModalContent,
    getCurrentModalContentFromData,
    freezeState,
    reconcileStreakFreezes,
    shouldShowFreezeConsumedToast,
  } = useStreak(user?.id);
  const { submitTransaction, deleteTransaction } = useTransactions();
  const { checkCreditUsageAlert } = useCreditCardNotifications();
  const toast = useToast();
  const { confirm } = useConfirm();
  const { t } = useLanguage();
  const { theme } = useTheme();
  const modals = useModalStates();
  const { openStreakModal } = modals;



  const [granularity, setGranularity] = useState(readGranularity);
  // 月與年各自記住自己的錨點：切粒度不會把使用者從原本看的位置彈走
  const [monthAnchor, setMonthAnchor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const [yearAnchor, setYearAnchor] = useState(() => ({ year: new Date().getFullYear() }));
  const isYearMode = granularity === 'year';
  const period = useMemo(
    () => (granularity === 'year'
      ? { granularity: 'year', year: yearAnchor.year }
      : { granularity: 'month', year: monthAnchor.year, month: monthAnchor.month }),
    [granularity, yearAnchor.year, monthAnchor.year, monthAnchor.month]
  );
  // 期間 → 查詢用日期區間；年模式的迄日是「今天」（見 lib/period.js）
  const periodRange = useMemo(() => getPeriodRange(period), [period]);
  const periodName = t(getPeriodNameKey(granularity));
  const yearRange = useTransactionYearRange(user?.id);
  // 期間選擇器面板上正在看的年份（可與檢視中的期間不同：翻年份不等於已選定）
  const [pickerYear, setPickerYear] = useState(() => new Date().getFullYear());
  const monthsWithData = useTransactionMonthsInYear(user?.id, pickerYear);
  // 夠寬時把月／年切換器直接放在畫面上（發現性）；窄視窗收進面板，避免頂列換行
  const { width: viewportWidth } = useWindowSize();
  const showInlineToggle = viewportWidth >= GRANULARITY_TOGGLE_MIN_WIDTH;
  const [editingTransaction, setEditingTransaction] = useState(null);
  // 凍結卡對帳若實際橋接了缺口，就 +1 觸發 dashboard 重抓，讓 streak 反映補上的凍結日
  const [streakRefreshTick, setStreakRefreshTick] = useState(0);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  // 自訂區間匯出彈窗開關
  const [exportRangeOpen, setExportRangeOpen] = useState(false);
  const [page, setPage] = useState(1);
  const searchInputRef = useRef(null);
  const filterBtnRef = useRef(null);
  const {
    results: searchResults,
    totalCount: searchTotalCount,
    summary: searchSummary,
    searching: searchLoading,
    searchError,
    refresh: refreshSearch,
  } = useTransactionSearch(user?.id, searchQuery);
  const searchActive = searchQuery.trim() !== '';

  // 切換期間/粒度或進入搜尋模式時，彈窗內的明細已與畫面不一致，直接關閉
  useEffect(() => {
    if (modals.categoryDetailModal.open) modals.closeCategoryDetailModal();
    if (modals.creditCardModal.open) modals.closeCreditCardModal();
    if (modals.accountBalanceModal.open) modals.closeAccountBalanceModal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity, monthAnchor.year, monthAnchor.month, yearAnchor.year, searchActive]);

  // 點搜尋 icon 展開/收合；收合時清空關鍵字回到當月列表
  const toggleSearch = useCallback(() => {
    setSearchOpen((open) => {
      if (open) setSearchQuery('');
      return !open;
    });
  }, []);

  // 搜尋框為空時、點到別處(blur)才收合；打叉清空(原生 X)只清字並保持開啟聚焦，不被誤解為關閉
  const handleSearchBlur = useCallback(() => {
    if (!searchQuery.trim()) setSearchOpen(false);
  }, [searchQuery]);

  // 展開後自動聚焦輸入框
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  // 用 ref 讀取 toast/t，讓它們不必進 reconcile effect 的 deps（否則切換語言會重打對帳 RPC）
  const toastRef = useRef(toast);
  const tRef = useRef(t);
  useEffect(() => {
    toastRef.current = toast;
    tRef.current = t;
  });

  // 粒度切換：兩個錨點都不動，只換 granularity（並記進 localStorage）
  const changeGranularity = useCallback((next) => {
    setGranularity(next);
    try {
      localStorage.setItem(GRANULARITY_KEY, next);
    } catch {
      // 隱私模式等寫入失敗時忽略，粒度只是不跨重整保留
    }
  }, []);

  // 年模式的交易列：月 RPC 只回當月，年檢視改走區間查詢（不動資料庫函式，CLI 也在用）
  const [yearData, setYearData] = useState(null); // { rows, total } | { rows: [], total: 0, failed: true }
  const [yearLoading, setYearLoading] = useState(false);
  // 快速連點不同年份時擋掉晚回來的舊請求（StrictMode 下 effect 跑兩次也一併擋掉）
  const yearReqIdRef = useRef(0);

  const loadYearData = useCallback(async ({ silent = false } = {}) => {
    if (!user?.id) return;
    const reqId = ++yearReqIdRef.current;
    if (!silent) setYearLoading(true);
    const { startDate, endDate } = getPeriodRange({ granularity: 'year', year: yearAnchor.year });
    try {
      const { rows, count, error } = await fetchTransactionsByDateRange(user.id, startDate, endDate, {
        limit: RANGE_FETCH_LIMIT,
        count: true,
      });
      if (reqId !== yearReqIdRef.current) return;
      if (error) throw error;
      // 區間查詢是舊→新（匯出的 CSV 依賴那個順序），表格要與月模式一致改成新→舊
      const sorted = [...rows].sort((a, b) =>
        (b.date + (b.time || '')).localeCompare(a.date + (a.time || ''))
      );
      setYearData({ rows: sorted, total: count });
    } catch (err) {
      if (reqId !== yearReqIdRef.current) return;
      if (isOfflineError(err)) {
        // 離線沒有年度快照，停在空白畫面只會更困惑：退回月模式（月有快照可看）
        setYearData(null);
        changeGranularity('month');
        toastRef.current.info(tRef.current('dashboard.yearOfflineFallback'));
      } else {
        // 非離線錯誤停在年模式並顯示錯誤，不自動切走，避免使用者搞不清楚發生什麼事
        setYearData({ rows: [], total: 0, failed: true });
      }
    } finally {
      if (reqId === yearReqIdRef.current) setYearLoading(false);
    }
  }, [user?.id, yearAnchor.year, changeGranularity]);

  useEffect(() => {
    if (!isYearMode) {
      setYearData(null);
      return;
    }
    loadYearData().catch((err) => console.error('[Dashboard] fetch year data failed:', err));
  }, [isYearMode, loadYearData]);

  // 畫面資料來源：統計卡/圓餅圖/支付統計/明細表都只吃「一個交易陣列 + 一個 summary」，與粒度無關。
  // 年資料還沒回來時沿用上一份（月列表或前一年），圓餅圖才不會被卸載再重掛——
  // 那會變成「整個消失再跳出來」，而不是 Chart.js 的比例過渡動畫
  const yearRows = useMemo(() => yearData?.rows ?? [], [yearData]);
  const periodHistory = isYearMode && yearData ? yearRows : transactionHistoryFull;
  const periodSummary = useMemo(
    () => (isYearMode && yearData ? sumTransactions(yearRows) : summary),
    [isYearMode, yearData, yearRows, summary]
  );

  // 寫入後重抓：月 RPC 一定要抓（accounts / categories / streak 只有它回傳），
  // 年模式還要一併重抓年區間，否則畫面數字不會更新
  const refetchPeriod = useCallback(async () => {
    const data = await fetchDashboardData(monthAnchor.year, monthAnchor.month, { silent: true });
    if (isYearMode) loadYearData({ silent: true });
    return data;
  }, [fetchDashboardData, monthAnchor.year, monthAnchor.month, isYearMode, loadYearData]);

  // 離線記帳佇列:自動補送(掛載 + 恢復連線)並把未同步交易併入目前期間的列表與彙總,結果以 toast 通知
  const {
    queuedItems,
    pendingCount,
    flushNow,
    removeQueuedItem,
    displayHistory,
    displaySummary,
  } = useOfflineMergedView({
    history: periodHistory,
    summary: periodSummary,
    startDate: periodRange.startDate,
    endDate: periodRange.endDate,
    onSynced: (result) => {
      toast.success(t('dashboard.syncSuccess', { count: result.synced }));
      refetchPeriod().catch((err) => console.error('[Dashboard] refetch after sync failed:', err));
    },
    onFailed: (result) => toast.error(t('dashboard.syncFailed', { count: result.failed })),
    onNeedsLogin: () => toast.error(t('dashboard.syncNeedsLogin')),
  });

  const formRef = useRef(null);
  const historyRef = useRef(null);

  // stat 來自支付方式統計，直接沿用它算好的本期紀錄，明細與上方金額必然一致
  const handleOpenCreditCard = useCallback((account, stat) => {
    modals.openCreditCardModal(account, stat?.txs || []);
    fetchCreditHistory(account);
  }, [fetchCreditHistory, modals]);

  const handleOpenAccountBalance = useCallback((account, stat) => {
    modals.openAccountBalanceModal(account, stat?.txs || []);
    fetchBalanceHistory(account);
  }, [fetchBalanceHistory, modals]);

  // 彈窗開著時存了新餘額，重抓後要吃到新的帳戶資料。
  // 彈窗自己存的是「點下去那一刻」的帳戶，會停在舊金額
  const balanceModalAccount = useMemo(() => {
    const opened = modals.accountBalanceModal.account;
    if (!opened) return null;
    return accounts.find((a) => a.id === opened.id) || opened;
  }, [accounts, modals.accountBalanceModal.account]);

  // 存完要重抓：帳戶餘額只有月 RPC 會回傳（refetchPeriod 已經處理年模式）。
  // 餘額期間的交易也要重抓——設定時間換成現在，該扣的範圍跟著往後移
  const handleUpdateBalance = useCallback(async (account, amount) => {
    await updateAccountBalance(account, amount);
    const updated = { ...account, balance_amount: amount, balance_as_of: new Date().toISOString() };
    await Promise.all([refetchPeriod(), fetchBalanceHistory(updated)]);
  }, [updateAccountBalance, refetchPeriod, fetchBalanceHistory]);

  useEffect(() => {
    if (user) ensureDefaultDataForOAuth(user.id);
  }, [user, ensureDefaultDataForOAuth]);

  // 開 App 對帳：呼叫 reconcile_streak_freezes 補橋接漏記的缺口並發卡。
  // 與 dashboard 抓取平行進行（不擋首載）；只有實際橋接了缺口（consumedThisCall>0）
  // 才 +1 觸發重抓，讓 streak 反映補上的凍結日。
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    reconcileStreakFreezes()
      .then(async (data) => {
        if (cancelled || !data) return;
        if (await shouldShowFreezeConsumedToast(data)) {
          if (cancelled) return;
          toastRef.current.info(tRef.current('streak.freezeConsumedToast', { count: data.consumedThisCall }));
        }
        if ((data.consumedThisCall ?? 0) > 0) {
          setStreakRefreshTick((n) => n + 1);
        }
      })
      .catch((err) => console.error('[Dashboard] reconcile streak freezes failed:', err));
    return () => { cancelled = true; };
  }, [user?.id, reconcileStreakFreezes, shouldShowFreezeConsumedToast]);

  // 月 RPC 永遠要打（即使目前是年模式）：記帳表單的分類下拉、支付統計的信用卡、簽到徽章都靠它
  useEffect(() => {
    fetchDashboardData(monthAnchor.year, monthAnchor.month).catch(err => console.error('[Dashboard] fetch failed:', err));
  }, [monthAnchor.year, monthAnchor.month, fetchDashboardData, streakRefreshTick]);

  // 設定面板等外部入口寫入資料後（訂閱的當日扣款、帳戶額度、類別改名…），靜默重抓當月資料
  useEffect(() => {
    return subscribeDataChanged(() => {
      refetchPeriod()
        .catch(err => console.error('[Dashboard] refetch after external change failed:', err));
    });
  }, [refetchPeriod]);

  useEffect(() => {
    fetchCurrencies().catch(err => console.error('[Dashboard] fetchCurrencies failed:', err));
  }, [fetchCurrencies]);

  useEffect(() => {
    if (!dashboardData) return;
    updateStreakFromServer(dashboardData);
  }, [dashboardData, updateStreakFromServer]);

  // Show broken streak modal once per day on initial load.
  useEffect(() => {
    if (!dashboardData || streakInitialHandled) return;
    setStreakInitialHandled(true);
    let cancelled = false;
    shouldShowBrokenModal(dashboardData.streakBroken)
      .then((show) => {
        if (!cancelled && show) openStreakModal(t('streak.brokenTitle'), 'broken');
      })
      .catch((err) => console.error('[Dashboard] broken streak modal check failed:', err));
    return () => { cancelled = true; };
  }, [dashboardData, streakInitialHandled, setStreakInitialHandled, shouldShowBrokenModal, openStreakModal, t]);

  const handlePeriodChange = useCallback((next) => {
    if (next.granularity === 'year') setYearAnchor({ year: next.year });
    else setMonthAnchor({ year: next.year, month: next.month });
  }, []);

  const resolveSplitSynced = useCallback(async (transaction) => {
    if (!transaction?.id) return false;
    if (typeof transaction.isSplitSynced === 'boolean') return transaction.isSplitSynced;

    const heuristicGuess =
      transaction.note === '從分帳群組同步' || transaction.category === '分帳';

    const { data, error } = await supabase
      .from('split_ledger_syncs')
      .select('id')
      .eq('transaction_id', transaction.id)
      .maybeSingle();

    if (error) return heuristicGuess;
    return !!data;
  }, []);

  const handleTransactionSubmit = useCallback(
    async (formData, editId) => {
      try {
        const result = await submitTransaction(formData, editId, {
          isSplitSynced: !!editingTransaction?.isSplitSynced,
        });

        // 離線入列:不重新抓資料(佇列訂閱會更新列表),不觸發 streak/信用卡檢查
        if (result.queued) {
          setEditingTransaction(null);
          toast.info(t('dashboard.offlineQueued'));
          return;
        }

        setEditingTransaction(null);
        toast.success(result.isEdit ? t('dashboard.transactionUpdated') : t('dashboard.transactionAdded'));
        invalidateTransactionMonths(user?.id);
        refetchPeriod().catch((err) => console.error('[Dashboard] refetch after write failed:', err));
        refreshSearch();

        if (!result.isEdit && (await shouldShowPositiveModal(result.date))) {
          const content = getPositiveModalContent();
          openStreakModal(content.title, 'positive');
        }

        // 若此筆交易的付款方式為信用卡，檢查使用率並在需要時推播警告
        // （accounts 來自 RPC，欄位為駝峰 accountName）
        const usedAccount = accounts.find((a) => (a.accountName || a.name) === formData.paymentMethod);
        if (usedAccount?.type === 'credit_card') checkCreditUsageAlert(usedAccount);
      } catch (err) {
        toast.error(err.message || t('dashboard.addTransactionFailed'));
        throw err;
      }
    },
    [
      submitTransaction,
      refetchPeriod,
      user?.id,
      toast,
      shouldShowPositiveModal,
      getPositiveModalContent,
      openStreakModal,
      accounts,
      checkCreditUsageAlert,
      editingTransaction,
      refreshSearch,
      t,
    ]
  );

  const handleCancelEdit = useCallback(() => {
    setEditingTransaction(null);
    setTimeout(() => {
      historyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }, []);

  const handleStartEdit = useCallback(async (transaction) => {
    // 未同步的離線交易還沒有伺服器資料,先擋編輯(可刪除重記)
    if (transaction.pending) {
      toast.info(t('dashboard.pendingEditBlocked'));
      return;
    }
    const isSplitSynced = await resolveSplitSynced(transaction);
    setEditingTransaction({ ...transaction, isSplitSynced });
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }, [resolveSplitSynced, toast, t]);

  const handleDeleteTransaction = useCallback(
    async (id) => {
      const confirmed = await confirm(t('dashboard.deleteTransactionConfirm'), { danger: true });
      if (!confirmed) return false;
      // 未同步的離線交易:直接從本地佇列移除,不打伺服器
      if (queuedItems.some((item) => item.id === id)) {
        removeQueuedItem(id);
        toast.success(t('dashboard.transactionDeleted'));
        return true;
      }
      // 找到要刪除的交易，記錄其付款帳戶（刪除後無法再查）
      // （history 與 accounts 皆來自 RPC，欄位為駝峰 paymentMethod / accountName）
      const txToDelete = displayHistory.find((tx) => tx.id === id);
      const relatedAccount = txToDelete
        ? accounts.find((a) => (a.accountName || a.name) === txToDelete.paymentMethod)
        : null;
      try {
        await deleteTransaction(id);
        removeTransactionLocally(id);
        toast.success(t('dashboard.transactionDeleted'));
        invalidateTransactionMonths(user?.id);
        refetchPeriod().catch((err) => console.error('[Dashboard] refetch after write failed:', err));
        refreshSearch();
        // 刪除後重新計算信用卡使用率
        if (relatedAccount?.type === 'credit_card') checkCreditUsageAlert(relatedAccount);
        return true;
      } catch (err) {
        toast.error(err.message || t('dashboard.deleteTransactionFailed'));
        return false;
      }
    },
    [confirm, deleteTransaction, removeTransactionLocally, refetchPeriod, user?.id, toast, displayHistory, accounts, checkCreditUsageAlert, queuedItems, removeQueuedItem, refreshSearch, t]
  );

  const handleCheckin = useCallback(async () => {
    try {
      await submitDailyCheckin();
      const data = await refetchPeriod();
      if (data) {
        updateStreakFromServer(data);
        const content = getCurrentModalContentFromData(data);
        openStreakModal(content.title, content.variant);
      } else {
        const content = getCurrentModalContent();
        openStreakModal(content.title, content.variant);
      }
      toast.success(t('dashboard.checkinSuccess'));
    } catch (err) {
      toast.error(err.message || t('dashboard.checkinFailed'));
    }
  }, [submitDailyCheckin, refetchPeriod, updateStreakFromServer, toast, getCurrentModalContentFromData, getCurrentModalContent, openStreakModal, t]);

  const handleStreakBadgeClick = useCallback(() => {
    const content = getCurrentModalContent();
    openStreakModal(content.title, content.variant);
  }, [getCurrentModalContent, openStreakModal]);


  const checkedInToday = hasCheckinToday();

  const streakBadge = (
    <StreakBadge
      streakState={streakState}
      onClick={handleStreakBadgeClick}
    />
  );

  const tableRows = searchActive ? searchResults : displayHistory;

  // 改篩選會讓筆數變少，一律回第 1 頁
  const { filteredRows, sections: filterSections, activeFilter, toggleFilter, closeFilter, isFiltered } =
    useTransactionFilters(tableRows, useCallback(() => setPage(1), []));
  const visibleRowCount = filteredRows.length;

  // 交易列表的分類色點與每日佔比帶，跟旁邊的圓餅圖共用同一份顏色對應。
  // 一定要用未篩選的期間資料算：拿篩選後的資料會改變分類排名，顏色就跟圓餅圖對不起來。
  const categoryColors = useMemo(
    () => buildCategoryColorMap(displayHistory, categoriesIncome, getChartPalette(theme), t('transaction.uncategorized')),
    [displayHistory, categoriesIncome, theme, t]
  );

  const periodFileLabel = getPeriodFileLabel(period);
  // 只有真的沒東西可顯示時才換成載入佔位；有舊資料就讓它留著等新資料進來（見 periodHistory）
  const viewLoading = loading || (isYearMode && yearLoading && periodHistory.length === 0);
  // 年資料被筆數上限截斷 / 載入失敗（非離線）時要明講，不可靜默
  const yearCapped = isYearMode && !!yearData && !yearData.failed && yearData.total > yearData.rows.length;
  const yearFailed = isYearMode && !!yearData?.failed;

  const totalPages = Math.max(1, Math.ceil(visibleRowCount / PAGE_SIZE));

  // 換期間 / 換粒度 / 搜尋字改變 / 進出搜尋模式 → 一律回第 1 頁
  useEffect(() => {
    setPage(1);
  }, [granularity, monthAnchor.year, monthAnchor.month, yearAnchor.year, searchQuery]);

  // 表頭篩選讓筆數變少、或刪掉當頁最後一筆時頁碼會越界 → 被動退到最後一頁
  useEffect(() => {
    setPage((p) => (p > totalPages ? totalPages : p));
  }, [totalPages]);

  const goToPage = useCallback((next) => {
    setPage(next);
    historyRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);


  // 匯出目前期間（一般模式下的匯出鈕主選項）：tableRows 是整個期間的完整陣列，不是畫面上那一頁
  const exportCurrentPeriod = useCallback(async () => {
    if (tableRows.length === 0) return;

    const confirmed = await confirm(
      t('dashboard.exportConfirmPeriod', { count: tableRows.length, label: periodFileLabel })
    );
    if (!confirmed) return;

    const csv = buildTransactionsCsv(tableRows, {
      headers: [
        t('transaction.tableDate'),
        t('transaction.tableType'),
        t('transaction.tableCategory'),
        t('transaction.tableItem'),
        t('transaction.tablePayment'),
        t('transaction.currencyLabel'),
        t('transaction.tableAmount'),
        t('transaction.twdAmount'),
        t('transaction.note'),
      ],
      typeLabels: {
        expense: t('transaction.expenseGroup'),
        income: t('transaction.incomeGroup'),
      },
    });
    downloadCsv(`my-smart-finance-${periodFileLabel}.csv`, csv);
  }, [tableRows, periodFileLabel, t, confirm]);

  // 匯出搜尋結果（搜尋模式下的匯出鈕主選項）：保留原本 capped/一般確認、完整抓取、錯誤 toast 與檔名，行為不變
  const exportSearchResults = useCallback(async () => {
    if (searchResults.length === 0) return;

    const confirmed = await confirm(
      searchTotalCount > SEARCH_LIMIT
        ? t('dashboard.exportConfirmSearchCapped', { count: searchTotalCount })
        : t('dashboard.exportConfirmSearch', { count: searchTotalCount })
    );
    if (!confirmed) return;

    // 畫面上最多只有 SEARCH_LIMIT 筆，總數超過時要另外抓齊全部符合的列再匯出
    let exportRows = searchResults;
    if (searchTotalCount > searchResults.length) {
      const { rows, error } = await fetchTransactionMatches(user.id, searchQuery, {
        limit: searchTotalCount,
      });
      if (error) {
        toast.error(t('dashboard.exportFailed'));
        return;
      }
      exportRows = rows;
    }

    const csv = buildTransactionsCsv(exportRows, {
      headers: [
        t('transaction.tableDate'),
        t('transaction.tableType'),
        t('transaction.tableCategory'),
        t('transaction.tableItem'),
        t('transaction.tablePayment'),
        t('transaction.currencyLabel'),
        t('transaction.tableAmount'),
        t('transaction.twdAmount'),
        t('transaction.note'),
      ],
      typeLabels: {
        expense: t('transaction.expenseGroup'),
        income: t('transaction.incomeGroup'),
      },
    });
    downloadCsv('my-smart-finance-search.csv', csv);
  }, [searchResults, searchTotalCount, searchQuery, user, t, confirm, toast]);

  // 自訂區間匯出：start/end 若顛倒自動對調，查出區間內全部交易後下載，無資料時提示不下載
  const exportRange = useCallback(async (start, end) => {
    const pad = (n) => String(n).padStart(2, '0');
    let { year: sy, month: sm } = start;
    let { year: ey, month: em } = end;
    if (sy * 12 + sm > ey * 12 + em) {
      [sy, sm, ey, em] = [ey, em, sy, sm];
    }

    const startDate = `${sy}-${pad(sm)}-01`;
    const lastDay = new Date(ey, em, 0).getDate();
    const endDate = `${ey}-${pad(em)}-${pad(lastDay)}`;

    const { rows, error } = await fetchTransactionsByDateRange(user.id, startDate, endDate);
    if (error) {
      toast.error(t('dashboard.exportFailed'));
      return;
    }
    if (rows.length === 0) {
      toast.info(t('dashboard.exportRangeEmpty'));
      return;
    }

    const csv = buildTransactionsCsv(rows, {
      headers: [
        t('transaction.tableDate'),
        t('transaction.tableType'),
        t('transaction.tableCategory'),
        t('transaction.tableItem'),
        t('transaction.tablePayment'),
        t('transaction.currencyLabel'),
        t('transaction.tableAmount'),
        t('transaction.twdAmount'),
        t('transaction.note'),
      ],
      typeLabels: {
        expense: t('transaction.expenseGroup'),
        income: t('transaction.incomeGroup'),
      },
    });
    downloadCsv(`my-smart-finance-${sy}-${pad(sm)}_${ey}-${pad(em)}.csv`, csv);
    setExportRangeOpen(false);
  }, [user, t, toast]);

  return (
    <div className="app-container">
      <TopBar streakBadge={streakBadge} />

      <FormColumn>
        <div ref={formRef}>
          <TransactionForm
            categoriesExpense={categoriesExpense}
            categoriesIncome={categoriesIncome}
            accounts={accounts}
            currencies={currencies}
            defaultCurrency={defaultCurrency}
            editingTransaction={editingTransaction}
            paymentOptional={!!editingTransaction?.isSplitSynced}
            onSubmit={handleTransactionSubmit}
            onCancelEdit={handleCancelEdit}
            onCheckin={handleCheckin}
            hasCheckinToday={checkedInToday}
            disabled={loading}
          />
        </div>
      </FormColumn>

      <DashboardColumn>
        <YearlyReviewBanner />

        <section className="stats-section">
          <div className="stats-section-header">
            <div className="stats-section-header__title-group">
              <h2>{t('dashboard.overview')}</h2>
              <PeriodPicker
                period={period}
                onChange={handlePeriodChange}
                onGranularityChange={showInlineToggle ? undefined : changeGranularity}
                yearRange={yearRange}
                monthsWithData={monthsWithData}
                onDisplayYearChange={setPickerYear}
                yearDisabled={!!offlineSnapshot}
                disabled={loading}
              />
              {showInlineToggle && (
                <div className="period-toggle" role="tablist" aria-label={t('periodPicker.granularityAria')}>
                  {['month', 'year'].map((g) => (
                    <button
                      key={g}
                      type="button"
                      role="tab"
                      aria-selected={granularity === g}
                      className={`period-toggle__btn${granularity === g ? ' is-active' : ''}`}
                      disabled={g === 'year' && !!offlineSnapshot}
                      title={g === 'year' && offlineSnapshot ? t('periodPicker.yearOfflineHint') : undefined}
                      onClick={() => changeGranularity(g)}
                    >
                      {g === 'year' ? t('periodPicker.tabYear') : t('periodPicker.tabMonth')}
                    </button>
                  ))}
                </div>
              )}
              {/* 年模式沒有離線快照，顯示徽章會誤導 */}
              {!isYearMode && offlineSnapshot && (
                <span className="offline-badge">
                  {t('dashboard.offlineData', {
                    time: new Date(offlineSnapshot.savedAt).toLocaleString([], {
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    }),
                  })}
                </span>
              )}
              {pendingCount > 0 && (
                <button
                  type="button"
                  className="pending-sync-pill"
                  onClick={() => flushNow({ includeFailed: true })}
                >
                  {t('dashboard.pendingSyncCount', { count: pendingCount })}
                </button>
              )}
            </div>
            {streakBadge}
          </div>
          <StatCards summary={searchActive ? searchSummary : displaySummary} loading={viewLoading} />
        </section>

        {!searchActive && (
        <section className="analytics-section">
          <h2>{t('dashboard.analytics')}</h2>
          <div className="analytics-grid">
            <div className="analytics-col category-breakdown">
              <h3>{t('dashboard.categoryBreakdown')}</h3>
              {viewLoading ? (
                <p className="category-stats-empty">{t('common.loadingDots')}</p>
              ) : (
                <CategoryChart
                  history={displayHistory}
                  incomeCategories={categoriesIncome}
                  onSelectCategory={modals.openCategoryDetailModal}
                  periodName={periodName}
                />
              )}
            </div>
            <div className="analytics-col payment-breakdown">
              <h3>{t('dashboard.paymentBreakdown')}</h3>
              {viewLoading ? (
                <p className="payment-stats-empty">{t('common.loadingDots')}</p>
              ) : (
                <PaymentStats
                  history={displayHistory}
                  accounts={accounts}
                  onOpenCreditCard={handleOpenCreditCard}
                  onOpenAccountBalance={handleOpenAccountBalance}
                  onSelectMethod={modals.openCategoryDetailModal}
                  periodName={periodName}
                />
              )}
            </div>
          </div>
        </section>
        )}

        <section className="transaction-history-section" ref={historyRef}>
          <div className="transaction-history-header">
            <div className="transaction-history-header__title">
              <h2>{t('dashboard.transactions')}</h2>
              {totalPages > 1 && (
                <div className="transaction-pager">
                  <button
                    type="button"
                    className="transaction-pager__btn"
                    onClick={() => goToPage(page - 1)}
                    disabled={page <= 1}
                    aria-label={t('dashboard.pagerPrev')}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                    </svg>
                  </button>
                  <span className="transaction-pager__label">{page} / {totalPages}</span>
                  <button
                    type="button"
                    className="transaction-pager__btn"
                    onClick={() => goToPage(page + 1)}
                    disabled={page >= totalPages}
                    aria-label={t('dashboard.pagerNext')}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
            {searchOpen && (
              <div className="transaction-search-box">
                <input
                  ref={searchInputRef}
                  type="search"
                  className="transaction-search-input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onBlur={handleSearchBlur}
                  placeholder={t('dashboard.searchPlaceholder')}
                  aria-label={t('dashboard.searchPlaceholder')}
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="transaction-search-clear"
                    // 用 mousedown 擋 blur：清空後仍保持聚焦、不被 handleSearchBlur 收合
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setSearchQuery('');
                      searchInputRef.current?.focus();
                    }}
                    aria-label={t('dashboard.searchClear')}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            )}
            <div className="transaction-history-header__controls">
              <button
                ref={filterBtnRef}
                type="button"
                className={`btn-search-toggle${activeFilter || isFiltered ? ' btn-search-toggle--active' : ''}`}
                onClick={toggleFilter}
                aria-label={t('transaction.filterOptionsAria')}
                aria-expanded={activeFilter === 'all'}
              >
                <svg className="icon-filter" aria-hidden="true">
                  <use href="#icon-filter" />
                </svg>
              </button>
              <button
                type="button"
                className={`btn-search-toggle${searchOpen ? ' btn-search-toggle--active' : ''}`}
                onMouseDown={(e) => { if (searchOpen) e.preventDefault(); }}
                onClick={toggleSearch}
                aria-label={t('dashboard.searchPlaceholder')}
                aria-expanded={searchOpen}
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                </svg>
              </button>
              <ExportMenu
                triggerAriaLabel={t('dashboard.exportCsvAria')}
                primaryLabel={
                  searchActive
                    ? t('dashboard.exportMenuSearch', { count: searchTotalCount })
                    : t('dashboard.exportMenuPeriod', { period: periodName, label: periodFileLabel })
                }
                primaryDisabled={searchActive ? searchResults.length === 0 : tableRows.length === 0}
                onExportPrimary={searchActive ? exportSearchResults : exportCurrentPeriod}
                rangeLabel={t('dashboard.exportMenuRange')}
                onExportRange={() => setExportRangeOpen(true)}
              />
            </div>
          </div>
          {searchActive && (
            <p
              className={`transaction-search-hint${searchError ? ' transaction-search-hint--error' : ''}`}
              role="status"
            >
              {searchLoading
                ? t('common.loadingDots')
                : searchError
                ? t('dashboard.searchFailed')
                : searchTotalCount > SEARCH_LIMIT
                ? t('dashboard.searchResultCountCapped', { count: searchTotalCount })
                : t('dashboard.searchResultCount', { count: visibleRowCount })}
            </p>
          )}
          {!searchActive && yearFailed && (
            <p className="transaction-search-hint transaction-search-hint--error" role="status">
              {t('dashboard.yearLoadFailed')}
            </p>
          )}
          {!searchActive && yearCapped && (
            <p className="transaction-search-hint" role="status">
              {t('dashboard.yearRowsCapped', { count: yearData.total, limit: RANGE_FETCH_LIMIT })}
            </p>
          )}
          <TransactionTable
            transactions={filteredRows}
            onEdit={handleStartEdit}
            onDelete={handleDeleteTransaction}
            periodName={periodName}
            page={page}
            pageSize={PAGE_SIZE}
            groupByDate={!isYearMode}
            categoryColors={categoryColors}
            loading={viewLoading}
            emptyMessage={
              searchActive
                ? searchLoading
                  ? t('common.loadingDots')
                  : t('dashboard.searchNoResults')
                : tableRows.length > 0
                ? t('transaction.noFilterResults')
                : undefined
            }
          />

          <FilterPopover
            anchorRef={filterBtnRef}
            isOpen={activeFilter === 'all'}
            onClose={closeFilter}
            sections={filterSections}
          />
        </section>
      </DashboardColumn>

      <StreakModal
        isOpen={modals.streakModal.open}
        onClose={modals.closeStreakModal}
        streakState={streakState}
        freezeState={freezeState}
        title={modals.streakModal.title}
        variant={modals.streakModal.variant}
      />

      <CreditCardModal
        isOpen={modals.creditCardModal.open}
        onClose={modals.closeCreditCardModal}
        account={modals.creditCardModal.account}
        history={creditHistory}
        txs={modals.creditCardModal.txs}
        onEdit={handleStartEdit}
        onDelete={handleDeleteTransaction}
        periodName={periodName}
        viewedYear={period.year}
        viewedMonth={isYearMode ? null : period.month}
        otherPeriod={isYearMode ? true : undefined}
      />

      <AccountBalanceModal
        isOpen={modals.accountBalanceModal.open}
        onClose={modals.closeAccountBalanceModal}
        account={balanceModalAccount}
        history={balanceHistory}
        txs={modals.accountBalanceModal.txs}
        onEdit={handleStartEdit}
        onDelete={handleDeleteTransaction}
        onUpdateBalance={handleUpdateBalance}
        periodName={periodName}
        viewedYear={period.year}
        viewedMonth={isYearMode ? null : period.month}
        otherPeriod={isYearMode ? true : undefined}
      />

      <CategoryDetailModal
        isOpen={modals.categoryDetailModal.open}
        onClose={modals.closeCategoryDetailModal}
        category={modals.categoryDetailModal.category}
        onEdit={handleStartEdit}
        onDelete={handleDeleteTransaction}
        periodName={periodName}
      />

      <ExportRangeModal
        isOpen={exportRangeOpen}
        onClose={() => setExportRangeOpen(false)}
        initialYear={period.year}
        initialMonth={isYearMode ? 1 : period.month}
        onExport={(s, e) => exportRange(s, e)}
      />

    </div>
  );
}
