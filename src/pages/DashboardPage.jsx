import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useDashboard } from '@/hooks/useDashboard';
import { useStreak } from '@/hooks/useStreak';
import { useTransactions } from '@/hooks/useTransactions';
import { useModalStates } from '@/hooks/useModalStates';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
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
import ChangelogModal from '@/components/common/ChangelogModal';
import StreakBadge from '@/components/streak/StreakBadge';
import StreakModal from '@/components/streak/StreakModal';
import UnifiedSettingsModal from '@/components/settings/UnifiedSettingsModal';

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
    loading,
    fetchDashboardData,
    fetchCurrencies,
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
  } = useStreak();
  const { submitTransaction, deleteTransaction } = useTransactions();
  const toast = useToast();
  const { confirm } = useConfirm();
  const modals = useModalStates();


  const [currentYear, setCurrentYear] = useState(() => new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(() => new Date().getMonth() + 1);
  const [editingTransaction, setEditingTransaction] = useState(null);

  const formRef = useRef(null);
  const historyRef = useRef(null);

  const handleOpenCreditCard = useCallback(async (account) => {
    await fetchCreditHistory(account);
    modals.openCreditCardModal(account);
  }, [fetchCreditHistory, modals]);

  useEffect(() => {
    if (user) ensureDefaultDataForOAuth(user.id);
  }, [user, ensureDefaultDataForOAuth]);

  useEffect(() => {
    fetchDashboardData(currentYear, currentMonth).catch(console.error);
  }, [currentYear, currentMonth, fetchDashboardData]);

  useEffect(() => {
    fetchCurrencies().catch(console.error);
  }, [fetchCurrencies]);

  useEffect(() => {
    if (!dashboardData) return;
    updateStreakFromServer(dashboardData);
  }, [dashboardData, updateStreakFromServer]);

  // Show broken streak modal once per day on initial load.
  // 使用 dashboardData.streakBroken 直接傳入，避免 updateStreakFromServer 非同步更新 streakState 時的競態問題
  useEffect(() => {
    if (!dashboardData || streakInitialHandled) return;
    setStreakInitialHandled(true);
    if (shouldShowBrokenModal(dashboardData.streakBroken)) {
      modals.openStreakModal('小壞蛋 你偷懶被抓到了！！！', 'broken');
    }
  }, [dashboardData, streakInitialHandled, setStreakInitialHandled, shouldShowBrokenModal, modals.openStreakModal]);

  const handleMonthChange = useCallback((year, month) => {
    setCurrentYear(year);
    setCurrentMonth(month);
  }, []);

  const handleTransactionSubmit = useCallback(
    async (formData, editId) => {
      try {
        const result = await submitTransaction(formData, editId);
        const [y, m] = result.date
          ? result.date.split('-')
          : [String(currentYear), String(currentMonth)];
        await fetchDashboardData(parseInt(y, 10), parseInt(m, 10));
        setEditingTransaction(null);
        toast.success(result.isEdit ? '已更新。' : '記帳成功！');

        // Show positive streak modal once per day after adding a transaction
        if (!result.isEdit && shouldShowPositiveModal(result.date)) {
          const content = getPositiveModalContent();
          modals.openStreakModal(content.title, 'positive');
        }
      } catch (err) {
        toast.error(err.message || '記帳失敗，請稍後再試。');
        throw err;
      }
    },
    [submitTransaction, fetchDashboardData, currentYear, currentMonth, toast, shouldShowPositiveModal, getPositiveModalContent, modals.openStreakModal]
  );

  const handleCancelEdit = useCallback(() => {
    setEditingTransaction(null);
    setTimeout(() => {
      historyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }, []);

  const handleStartEdit = useCallback((transaction) => {
    setEditingTransaction(transaction);
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }, []);

  const handleDeleteTransaction = useCallback(
    async (id) => {
      const confirmed = await confirm('確定要刪除這筆交易嗎？', { danger: true });
      if (!confirmed) return;
      try {
        await deleteTransaction(id);
        await fetchDashboardData(currentYear, currentMonth);
        toast.success('已刪除。');
      } catch (err) {
        toast.error(err.message || '刪除失敗，請稍後再試。');
      }
    },
    [confirm, deleteTransaction, fetchDashboardData, currentYear, currentMonth, toast]
  );

  const handleCheckin = useCallback(async () => {
    try {
      await submitDailyCheckin();
      const data = await fetchDashboardData(currentYear, currentMonth);
      if (data) {
        updateStreakFromServer(data);
        const content = getCurrentModalContentFromData(data);
        modals.openStreakModal(content.title, content.variant);
      } else {
        const content = getCurrentModalContent();
        modals.openStreakModal(content.title, content.variant);
      }
      toast.success('今日簽到成功！');
    } catch (err) {
      toast.error(err.message || '簽到失敗，請稍後再試。');
    }
  }, [submitDailyCheckin, fetchDashboardData, updateStreakFromServer, currentYear, currentMonth, toast, getCurrentModalContentFromData, getCurrentModalContent, modals.openStreakModal]);

  const handleStreakBadgeClick = useCallback(() => {
    const content = getCurrentModalContent();
    modals.openStreakModal(content.title, content.variant);
  }, [getCurrentModalContent, modals.openStreakModal]);

  const handleSettingsClose = useCallback(() => {
    modals.closeSettings();
    fetchDashboardData(currentYear, currentMonth).catch(console.error);
  }, [fetchDashboardData, currentYear, currentMonth, modals.closeSettings]);

  const checkedInToday = hasCheckinToday();

  const streakBadge = (
    <StreakBadge
      streakState={streakState}
      onClick={handleStreakBadgeClick}
    />
  );

  return (
    <div className="app-container">
      <TopBar
        streakBadge={streakBadge}
        onOpenSettings={modals.openSettings}
        onOpenChangelog={modals.openChangelog}
      />

      <FormColumn
        onOpenSettings={modals.openSettings}
        onOpenChangelog={modals.openChangelog}
      >
        <div ref={formRef}>
          <TransactionForm
            categoriesExpense={categoriesExpense}
            categoriesIncome={categoriesIncome}
            accounts={accounts}
            currencies={currencies}
            editingTransaction={editingTransaction}
            onSubmit={handleTransactionSubmit}
            onCancelEdit={handleCancelEdit}
            onCheckin={handleCheckin}
            hasCheckinToday={checkedInToday}
            disabled={loading}
          />
        </div>
      </FormColumn>

      <DashboardColumn>
        <section className="stats-section">
          <div className="stats-section-header">
            <div className="stats-section-header__title-group">
              <h2>收支概覽</h2>
              <MonthPicker
                year={currentYear}
                month={currentMonth}
                onChange={handleMonthChange}
                disabled={loading}
              />
            </div>
            {streakBadge}
          </div>
          <StatCards summary={summary} loading={loading} />
        </section>

        <section className="analytics-section">
          <h2>分析統計</h2>
          <div className="analytics-grid">
            <div className="analytics-col category-breakdown">
              <h3>分類分析</h3>
              {loading ? (
                <p className="category-stats-empty">載入中...</p>
              ) : (
                <CategoryChart history={transactionHistoryFull} incomeCategories={categoriesIncome} />
              )}
            </div>
            <div className="analytics-col payment-breakdown">
              <h3>支付方式分析</h3>
              {loading ? (
                <p className="payment-stats-empty">載入中...</p>
              ) : (
                <PaymentStats
                  history={transactionHistoryFull}
                  accounts={accounts}
                  onOpenCreditCard={handleOpenCreditCard}
                />
              )}
            </div>
          </div>
        </section>

        <section className="transaction-history-section" ref={historyRef}>
          <h2>交易記錄</h2>
          <TransactionTable
            transactions={transactionHistoryFull}
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

      <UnifiedSettingsModal
        isOpen={modals.settingsOpen}
        onClose={handleSettingsClose}
        categoriesExpense={categoriesExpense}
        accounts={accounts}
        currencies={currencies}
      />

      <ChangelogModal
        isOpen={modals.changelogOpen}
        onClose={modals.closeChangelog}
      />
    </div>
  );
}
