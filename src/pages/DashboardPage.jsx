import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useDashboard } from '@/hooks/useDashboard';
import { useStreak } from '@/hooks/useStreak';
import { useTransactions } from '@/hooks/useTransactions';
import { useOfflineMergedView } from '@/hooks/useOfflineMergedView';
import { useCreditCardNotifications } from '@/hooks/useCreditCardNotifications';
import { useModalStates } from '@/hooks/useModalStates';
import { useTransactionSearch, fetchTransactionMatches, fetchTransactionsByDateRange, SEARCH_LIMIT } from '@/hooks/useTransactionSearch';
import { supabase } from '@/lib/supabase';
import { buildTransactionsCsv, downloadCsv } from '@/lib/csvExport';
import { subscribeTransactionsChanged } from '@/lib/transactionEvents';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useLanguage } from '@/contexts/LanguageContext';
import TopBar from '@/components/layout/TopBar';
import FormColumn from '@/components/layout/FormColumn';
import DashboardColumn from '@/components/layout/DashboardColumn';
import StatCards from '@/components/dashboard/StatCards';
import MonthPicker from '@/components/dashboard/MonthPicker';
import ExportMenu from '@/components/dashboard/ExportMenu';
import ExportRangeModal from '@/components/dashboard/ExportRangeModal';
import CategoryChart from '@/components/dashboard/CategoryChart';
import PaymentStats from '@/components/dashboard/PaymentStats';
import TransactionForm from '@/components/transactions/TransactionForm';
import TransactionTable from '@/components/transactions/TransactionTable';
import CreditCardModal from '@/components/common/CreditCardModal';
import StreakBadge from '@/components/streak/StreakBadge';
import StreakModal from '@/components/streak/StreakModal';
import YearlyReviewBanner from '@/components/dashboard/YearlyReviewBanner';

export default function DashboardPage() {
  const { user, ensureDefaultDataForOAuth } = useAuth();
  const {
    dashboardData,
    transactionHistoryFull,
    creditHistory,
    fetchCreditHistory,
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
  const modals = useModalStates();
  const { openStreakModal } = modals;



  const [currentYear, setCurrentYear] = useState(() => new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(() => new Date().getMonth() + 1);
  const [editingTransaction, setEditingTransaction] = useState(null);
  // 凍結卡對帳若實際橋接了缺口，就 +1 觸發 dashboard 重抓，讓 streak 反映補上的凍結日
  const [streakRefreshTick, setStreakRefreshTick] = useState(0);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  // 自訂區間匯出彈窗開關
  const [exportRangeOpen, setExportRangeOpen] = useState(false);
  // 表格套完表頭篩選後的實際列數（由 TransactionTable 回報），供搜尋提示顯示一致的筆數
  const [visibleRowCount, setVisibleRowCount] = useState(0);
  const searchInputRef = useRef(null);
  const {
    results: searchResults,
    totalCount: searchTotalCount,
    searching: searchLoading,
    searchError,
    refresh: refreshSearch,
  } = useTransactionSearch(user?.id, searchQuery);
  const searchActive = searchQuery.trim() !== '';

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

  // 離線記帳佇列:自動補送(掛載 + 恢復連線)並把未同步交易併入當月列表與彙總,結果以 toast 通知
  const {
    queuedItems,
    pendingCount,
    flushNow,
    removeQueuedItem,
    displayHistory,
    displaySummary,
  } = useOfflineMergedView({
    history: transactionHistoryFull,
    summary,
    year: currentYear,
    month: currentMonth,
    onSynced: (result) => {
      toast.success(t('dashboard.syncSuccess', { count: result.synced }));
      fetchDashboardData(currentYear, currentMonth, { silent: true });
    },
    onFailed: (result) => toast.error(t('dashboard.syncFailed', { count: result.failed })),
    onNeedsLogin: () => toast.error(t('dashboard.syncNeedsLogin')),
  });

  const formRef = useRef(null);
  const historyRef = useRef(null);

  const handleOpenCreditCard = useCallback((account) => {
    modals.openCreditCardModal(account);
    fetchCreditHistory(account);
  }, [fetchCreditHistory, modals]);

  useEffect(() => {
    if (user) ensureDefaultDataForOAuth(user.id);
  }, [user, ensureDefaultDataForOAuth]);

  // 用 ref 讀取 toast/t，讓它們不必進 reconcile effect 的 deps（否則切換語言會重打對帳 RPC）
  const toastRef = useRef(toast);
  const tRef = useRef(t);
  useEffect(() => {
    toastRef.current = toast;
    tRef.current = t;
  });

  // 開 App 對帳：呼叫 reconcile_streak_freezes 補橋接漏記的缺口並發卡。
  // 與 dashboard 抓取平行進行（不擋首載）；只有實際橋接了缺口（consumedThisCall>0）
  // 才 +1 觸發重抓，讓 streak 反映補上的凍結日。
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    reconcileStreakFreezes()
      .then((data) => {
        if (cancelled || !data) return;
        if (shouldShowFreezeConsumedToast(data)) {
          toastRef.current.info(tRef.current('streak.freezeConsumedToast', { count: data.consumedThisCall }));
        }
        if ((data.consumedThisCall ?? 0) > 0) {
          setStreakRefreshTick((n) => n + 1);
        }
      })
      .catch((err) => console.error('[Dashboard] reconcile streak freezes failed:', err));
    return () => { cancelled = true; };
  }, [user?.id, reconcileStreakFreezes, shouldShowFreezeConsumedToast]);

  useEffect(() => {
    fetchDashboardData(currentYear, currentMonth).catch(err => console.error('[Dashboard] fetch failed:', err));
  }, [currentYear, currentMonth, fetchDashboardData, streakRefreshTick]);

  // 設定面板等外部入口寫入交易後（例如訂閱的當日扣款），靜默重抓當月資料
  useEffect(() => {
    return subscribeTransactionsChanged(() => {
      fetchDashboardData(currentYear, currentMonth, { silent: true })
        .catch(err => console.error('[Dashboard] refetch after external tx failed:', err));
    });
  }, [currentYear, currentMonth, fetchDashboardData]);

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
    if (shouldShowBrokenModal(dashboardData.streakBroken)) {
      openStreakModal(t('streak.brokenTitle'), 'broken');
    }
  }, [dashboardData, streakInitialHandled, setStreakInitialHandled, shouldShowBrokenModal, openStreakModal, t]);

  const handleMonthChange = useCallback((year, month) => {
    setCurrentYear(year);
    setCurrentMonth(month);
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
        fetchDashboardData(currentYear, currentMonth, { silent: true });
        refreshSearch();

        if (!result.isEdit && shouldShowPositiveModal(result.date)) {
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
      fetchDashboardData,
      currentYear,
      currentMonth,
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
      if (!confirmed) return;
      // 未同步的離線交易:直接從本地佇列移除,不打伺服器
      if (queuedItems.some((item) => item.id === id)) {
        removeQueuedItem(id);
        toast.success(t('dashboard.transactionDeleted'));
        return;
      }
      // 找到要刪除的交易，記錄其付款帳戶（刪除後無法再查）
      // （history 與 accounts 皆來自 RPC，欄位為駝峰 paymentMethod / accountName）
      const txToDelete = transactionHistoryFull.find((tx) => tx.id === id);
      const relatedAccount = txToDelete
        ? accounts.find((a) => (a.accountName || a.name) === txToDelete.paymentMethod)
        : null;
      try {
        await deleteTransaction(id);
        removeTransactionLocally(id);
        toast.success(t('dashboard.transactionDeleted'));
        fetchDashboardData(currentYear, currentMonth, { silent: true });
        refreshSearch();
        // 刪除後重新計算信用卡使用率
        if (relatedAccount?.type === 'credit_card') checkCreditUsageAlert(relatedAccount);
      } catch (err) {
        toast.error(err.message || t('dashboard.deleteTransactionFailed'));
      }
    },
    [confirm, deleteTransaction, removeTransactionLocally, fetchDashboardData, currentYear, currentMonth, toast, transactionHistoryFull, accounts, checkCreditUsageAlert, queuedItems, removeQueuedItem, refreshSearch, t]
  );

  const handleCheckin = useCallback(async () => {
    try {
      await submitDailyCheckin();
      const data = await fetchDashboardData(currentYear, currentMonth, { silent: true });
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
  }, [submitDailyCheckin, fetchDashboardData, updateStreakFromServer, currentYear, currentMonth, toast, getCurrentModalContentFromData, getCurrentModalContent, openStreakModal, t]);

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
  const currentMonthLabel = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

  // 匯出本月（一般模式下的匯出鈕主選項）：保留原本的確認訊息與檔名，行為不變
  const exportCurrentMonth = useCallback(async () => {
    if (tableRows.length === 0) return;

    const confirmed = await confirm(
      t('dashboard.exportConfirmMonth', { count: tableRows.length, month: currentMonthLabel })
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
    downloadCsv(`my-smart-finance-${currentMonthLabel}.csv`, csv);
  }, [tableRows, currentMonthLabel, t, confirm]);

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
              <MonthPicker
                year={currentYear}
                month={currentMonth}
                onChange={handleMonthChange}
                disabled={loading}
              />
              {offlineSnapshot && (
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
          <StatCards summary={displaySummary} loading={loading} />
        </section>

        <section className="analytics-section">
          <h2>{t('dashboard.analytics')}</h2>
          <div className="analytics-grid">
            <div className="analytics-col category-breakdown">
              <h3>{t('dashboard.categoryBreakdown')}</h3>
              {loading ? (
                <p className="category-stats-empty">{t('common.loadingDots')}</p>
              ) : (
                <CategoryChart history={displayHistory} incomeCategories={categoriesIncome} />
              )}
            </div>
            <div className="analytics-col payment-breakdown">
              <h3>{t('dashboard.paymentBreakdown')}</h3>
              {loading ? (
                <p className="payment-stats-empty">{t('common.loadingDots')}</p>
              ) : (
                <PaymentStats
                  history={displayHistory}
                  accounts={accounts}
                  onOpenCreditCard={handleOpenCreditCard}
                />
              )}
            </div>
          </div>
        </section>

        <section className="transaction-history-section" ref={historyRef}>
          <div className="transaction-history-header">
            <h2>{t('dashboard.transactions')}</h2>
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
                    : t('dashboard.exportMenuMonth', { month: currentMonthLabel })
                }
                primaryDisabled={searchActive ? searchResults.length === 0 : tableRows.length === 0}
                onExportPrimary={searchActive ? exportSearchResults : exportCurrentMonth}
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
          <TransactionTable
            transactions={tableRows}
            onEdit={handleStartEdit}
            onDelete={handleDeleteTransaction}
            onVisibleCountChange={setVisibleRowCount}
            loading={loading}
            emptyMessage={
              searchActive
                ? searchLoading
                  ? t('common.loadingDots')
                  : t('dashboard.searchNoResults')
                : undefined
            }
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
        viewedYear={currentYear}
        viewedMonth={currentMonth}
      />

      <ExportRangeModal
        isOpen={exportRangeOpen}
        onClose={() => setExportRangeOpen(false)}
        initialYear={currentYear}
        initialMonth={currentMonth}
        onExport={(s, e) => exportRange(s, e)}
      />

    </div>
  );
}
