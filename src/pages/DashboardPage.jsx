import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useDashboard } from '@/hooks/useDashboard';
import { useStreak } from '@/hooks/useStreak';
import { useTransactions } from '@/hooks/useTransactions';
import { useOfflineSync } from '@/hooks/useOfflineSync';
import { useCreditCardNotifications } from '@/hooks/useCreditCardNotifications';
import { useModalStates } from '@/hooks/useModalStates';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useLanguage } from '@/contexts/LanguageContext';
import TopBar from '@/components/layout/TopBar';
import FormColumn from '@/components/layout/FormColumn';
import DashboardColumn from '@/components/layout/DashboardColumn';
import StatCards from '@/components/dashboard/StatCards';
import MonthPicker from '@/components/dashboard/MonthPicker';
import CategoryChart from '@/components/dashboard/CategoryChart';
import PaymentStats from '@/components/dashboard/PaymentStats';
import TransactionForm from '@/components/transactions/TransactionForm';
import TransactionTable from '@/components/transactions/TransactionTable';
import CreditCardModal from '@/components/common/CreditCardModal';
import StreakBadge from '@/components/streak/StreakBadge';
import StreakModal from '@/components/streak/StreakModal';
import YearlyReviewBanner from '@/components/dashboard/YearlyReviewBanner';

export default function DashboardPage() {
  const navigate = useNavigate();
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
  } = useStreak(user?.id);
  const { submitTransaction, deleteTransaction } = useTransactions();
  const { checkCreditUsageAlert } = useCreditCardNotifications();
  const toast = useToast();
  const { confirm } = useConfirm();
  const { t } = useLanguage();
  const modals = useModalStates();



  const [currentYear, setCurrentYear] = useState(() => new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(() => new Date().getMonth() + 1);
  const [editingTransaction, setEditingTransaction] = useState(null);

  // 離線記帳佇列:自動補送(掛載 + 恢復連線),結果以 toast 通知
  const { queuedItems, pendingCount, flushNow, removeQueuedItem } = useOfflineSync({
    onSynced: (result) => {
      toast.success(t('dashboard.syncSuccess', { count: result.synced }));
      fetchDashboardData(currentYear, currentMonth, { silent: true });
    },
    onFailed: (result) => toast.error(t('dashboard.syncFailed', { count: result.failed })),
    onNeedsLogin: () => toast.error(t('dashboard.syncNeedsLogin')),
  });

  // 把佇列中的交易(尚未同步)合併進當月列表與彙總,標記 pending 供 UI 顯示
  const queuedRows = useMemo(() => {
    if (queuedItems.length === 0) return [];
    const monthPrefix = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
    return queuedItems
      .filter((item) => String(item.tx?.date || '').startsWith(monthPrefix))
      .map((item) => ({
        id: item.tx.id,
        date: item.tx.date,
        type: item.tx.type,
        category: item.tx.category,
        itemName: item.tx.item_name,
        paymentMethod: item.tx.payment_method,
        currency: item.tx.currency,
        amount: item.tx.amount,
        twdAmount: item.tx.twd_amount,
        note: item.tx.note,
        pending: true,
      }));
  }, [queuedItems, currentYear, currentMonth]);

  const displayHistory = useMemo(() => {
    if (queuedRows.length === 0) return transactionHistoryFull;
    return [...queuedRows, ...transactionHistoryFull].sort((a, b) =>
      String(b.date).localeCompare(String(a.date))
    );
  }, [queuedRows, transactionHistoryFull]);

  const displaySummary = useMemo(() => {
    if (queuedRows.length === 0) return summary;
    let dIncome = 0;
    let dExpense = 0;
    for (const row of queuedRows) {
      const amt = typeof row.twdAmount === 'number' ? row.twdAmount : 0;
      if (row.type === 'income') dIncome += amt;
      else dExpense += amt;
    }
    return {
      ...summary,
      totalIncome: summary.totalIncome + dIncome,
      totalExpense: summary.totalExpense + dExpense,
      balance: summary.balance + dIncome - dExpense,
    };
  }, [queuedRows, summary]);

  const formRef = useRef(null);
  const historyRef = useRef(null);

  const handleOpenCreditCard = useCallback((account) => {
    modals.openCreditCardModal(account);
    fetchCreditHistory(account);
  }, [fetchCreditHistory, modals]);

  useEffect(() => {
    if (user) ensureDefaultDataForOAuth(user.id);
  }, [user, ensureDefaultDataForOAuth]);

  useEffect(() => {
    fetchDashboardData(currentYear, currentMonth).catch(err => console.error('[Dashboard] fetch failed:', err));
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
      modals.openStreakModal(t('streak.brokenTitle'), 'broken');
    }
  }, [dashboardData, streakInitialHandled, setStreakInitialHandled, shouldShowBrokenModal, modals.openStreakModal]);

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

        const [y, m] = result.date
          ? result.date.split('-')
          : [String(currentYear), String(currentMonth)];
        setEditingTransaction(null);
        toast.success(result.isEdit ? t('dashboard.transactionUpdated') : t('dashboard.transactionAdded'));
        fetchDashboardData(parseInt(y, 10), parseInt(m, 10), { silent: true });

        if (!result.isEdit && shouldShowPositiveModal(result.date)) {
          const content = getPositiveModalContent();
          modals.openStreakModal(content.title, 'positive');
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
      modals.openStreakModal,
      accounts,
      checkCreditUsageAlert,
      editingTransaction,
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
        // 刪除後重新計算信用卡使用率
        if (relatedAccount?.type === 'credit_card') checkCreditUsageAlert(relatedAccount);
      } catch (err) {
        toast.error(err.message || t('dashboard.deleteTransactionFailed'));
      }
    },
    [confirm, deleteTransaction, removeTransactionLocally, fetchDashboardData, currentYear, currentMonth, toast, transactionHistoryFull, accounts, checkCreditUsageAlert, queuedItems, removeQueuedItem, t]
  );

  const handleCheckin = useCallback(async () => {
    try {
      await submitDailyCheckin();
      const data = await fetchDashboardData(currentYear, currentMonth, { silent: true });
      if (data) {
        updateStreakFromServer(data);
        const content = getCurrentModalContentFromData(data);
        modals.openStreakModal(content.title, content.variant);
      } else {
        const content = getCurrentModalContent();
        modals.openStreakModal(content.title, content.variant);
      }
      toast.success(t('dashboard.checkinSuccess'));
    } catch (err) {
      toast.error(err.message || t('dashboard.checkinFailed'));
    }
  }, [submitDailyCheckin, fetchDashboardData, updateStreakFromServer, currentYear, currentMonth, toast, getCurrentModalContentFromData, getCurrentModalContent, modals.openStreakModal]);

  const handleStreakBadgeClick = useCallback(() => {
    const content = getCurrentModalContent();
    modals.openStreakModal(content.title, content.variant);
  }, [getCurrentModalContent, modals.openStreakModal]);


  const checkedInToday = hasCheckinToday();

  const streakBadge = (
    <StreakBadge
      streakState={streakState}
      onClick={handleStreakBadgeClick}
    />
  );

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
          <h2>{t('dashboard.transactions')}</h2>
          <TransactionTable
            transactions={displayHistory}
            onEdit={handleStartEdit}
            onDelete={handleDeleteTransaction}
            loading={loading}
          />
        </section>
      </DashboardColumn>

      <StreakModal
        isOpen={modals.streakModal.open}
        onClose={modals.closeStreakModal}
        streakState={streakState}
        title={modals.streakModal.title}
        variant={modals.streakModal.variant}
      />

      <CreditCardModal
        isOpen={modals.creditCardModal.open}
        onClose={modals.closeCreditCardModal}
        account={modals.creditCardModal.account}
        history={creditHistory}
      />

    </div>
  );
}
