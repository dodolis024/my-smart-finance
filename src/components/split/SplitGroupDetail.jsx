import { useEffect, useState } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useSplitExpenses } from '@/hooks/useSplitExpenses';
import { useSplitSync } from '@/hooks/useSplitSync';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import SplitExpenseItem from './SplitExpenseItem';
import SplitSettlement from './SplitSettlement';
import SplitShareDetailModal from './SplitShareDetailModal';
import AddExpenseModal from './AddExpenseModal';
import ManageMembersModal from './ManageMembersModal';
import GroupSettingsModal from './GroupSettingsModal';

export default function SplitGroupDetail({ group, onBack, rates, currencies, onAddMember, onRemoveMember, onUpdateMemberName, onUpdateGroup }) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const { t } = useLanguage();
  const { user } = useAuth();
  const actorMember = group.split_members?.find(m => m.user_id === user?.id);
  const {
    expenses, settlements, loading,
    fetchExpenses, addExpense, updateExpense, deleteExpense,
    addSettlement, deleteSettlement, calcSettlement,
  } = useSplitExpenses(group.id, {
    actorName: actorMember?.name ?? '',
    actorUserId: user?.id ?? '',
    groupName: group.name ?? '',
  });
  const { syncStatus, syncing, fetchSyncStatus, syncToLedger } = useSplitSync(group.id);
  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [addMembersOpen, setAddMembersOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showAllExpenses, setShowAllExpenses] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareDetailOpen, setShareDetailOpen] = useState(false);

  const handleSettingsSave = async ({ name, currency, defaultExpenseCurrency }) => {
    await onUpdateGroup(group.id, {
      name,
      currency,
      default_expense_currency: defaultExpenseCurrency,
    });
    toast.success(t('split.settingsUpdated'));
  };

  useEffect(() => { fetchExpenses(); }, [fetchExpenses]);
  useEffect(() => { if (actorMember) fetchSyncStatus(); }, [fetchSyncStatus, actorMember]);

  const members = group.split_members || [];
  const settlement = calcSettlement(members, expenses, settlements, rates, group.currency);

  const cur = group.currency || 'TWD';
  const ZERO_DECIMAL = new Set(['TWD', 'JPY', 'KRW', 'VND']);
  const fmtAmt = (amt) => {
    const d = ZERO_DECIMAL.has(cur) ? 0 : 2;
    const rounded = Number(amt.toFixed(d));
    return rounded.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  const memberTotals = {};
  members.forEach(m => { memberTotals[m.id] = 0; });
  const toRate = (rates && group.currency) ? (rates[group.currency] ?? 1) : 1;
  expenses.forEach(expense => {
    const fromRate = (rates && expense.currency) ? (rates[expense.currency] ?? 1) : 1;
    const factor = toRate > 0 ? fromRate / toRate : 1;
    (expense.split_expense_shares || []).forEach(s => {
      memberTotals[s.member_id] = (memberTotals[s.member_id] || 0) + Number(s.share) * factor;
    });
  });

  const handleAddExpense = async (data) => {
    await addExpense(data);
    toast.success(t('split.expenseAdded'));
    if (actorMember) fetchSyncStatus();
  };

  const handleUpdateExpense = async (expenseId, data) => {
    await updateExpense(expenseId, data);
    toast.success(t('split.expenseUpdated'));
    if (actorMember) fetchSyncStatus();
  };

  const handleDeleteExpense = async (id) => {
    const ok = await confirm(t('split.deleteExpenseConfirm'), { danger: true });
    if (!ok) return;
    try {
      await deleteExpense(id);
      toast.success(t('split.expenseDeleted'));
      if (actorMember) fetchSyncStatus();
    } catch {
      toast.error(t('split.deleteExpenseFailed'));
    }
  };

  const handleSettle = async (transaction) => {
    const amtStr = transaction.amount % 1 === 0
      ? transaction.amount.toLocaleString()
      : transaction.amount.toFixed(2);
    const ok = await confirm(
      t('split.settleConfirm', {
        from: transaction.from,
        currency: group.currency || 'TWD',
        amount: amtStr,
        to: transaction.to,
      })
    );
    if (!ok) return;
    try {
      await addSettlement({
        fromMember: transaction.fromId,
        toMember: transaction.toId,
        amount: transaction.amount,
        currency: group.currency || 'TWD',
        fromName: transaction.from,
        toName: transaction.to,
      });
      toast.success(t('split.settlementRecorded'));
    } catch {
      toast.error(t('split.settlementFailed'));
    }
  };

  const handleDeleteSettlement = async (id) => {
    const ok = await confirm(t('split.deleteSettlementConfirm'), { danger: true });
    if (!ok) return;
    try {
      await deleteSettlement(id);
      toast.success(t('split.settlementDeleted'));
    } catch {
      toast.error(t('split.deleteSettlementFailed'));
    }
  };

  const handleCopyLink = () => {
    const url = `${window.location.origin}${import.meta.env.BASE_URL}split/join/${group.invite_code}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(group.invite_code).then(() => {
      toast.success(t('split.codeCopied'));
    });
  };

  const handleSyncToLedger = async () => {
    try {
      const result = await syncToLedger();
      if (result?.is_update) {
        toast.success(t('split.ledgerUpdated'));
      } else {
        toast.success(t('split.syncSuccess'));
      }
    } catch (err) {
      toast.error(err?.message || t('split.syncFailed'));
    }
  };

  const memberMap = Object.fromEntries(members.map(m => [m.id, m.name]));
  const settlementHistory = settlements.map(s => ({
    ...s,
    fromName: memberMap[s.from_member] || s.from_member,
    toName: memberMap[s.to_member] || s.to_member,
  }));

  return (
    <>
      <div className="split-group-detail__header">
        <div className="split-group-detail__name-row">
          <p className="split-group-detail__name">{group.name}</p>
          <button type="button" className="split-group-detail__edit-name-btn" onClick={() => setSettingsOpen(true)} aria-label={t('split.editGroupSettings')}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
            </svg>
          </button>
        </div>
        <div className="split-group-detail__members-row">
          {members.map(m => (
            <span key={m.id} className="split-group-detail__member-chip">{m.name}</span>
          ))}
          <button
            type="button"
            className="split-group-detail__member-chip split-group-detail__member-add-btn"
            onClick={() => setAddMembersOpen(true)}
            aria-label={t('split.manageMembers')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" style={{ width: 14, height: 14 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM12.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM18.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Invite info */}
      <div className="split-group-detail__invite">
        <span className="split-group-detail__invite-label">{t('split.inviteCode')}</span>
        <span className="split-group-detail__invite-code" onClick={handleCopyCode} style={{ cursor: 'pointer' }} title={t('split.clickToCopyCode')}>
          {group.invite_code}
        </span>
        <button type="button" className="split-group-detail__invite-copy" onClick={handleCopyLink}>
          {copied ? t('split.copied') : t('split.copyLink')}
        </button>
      </div>

      {/* Expense list */}
      <div className="split-group-detail__section-header">
        <p className="split-group-detail__section-title">{t('split.expenseList')}</p>
        <button type="button" className="split-btn-secondary" style={{ width: 'auto', padding: '0.4rem 0.85rem', fontSize: '0.82rem' }} onClick={() => setAddExpenseOpen(true)}>
          {t('split.addExpense')}
        </button>
      </div>

      {loading ? (
        <p className="split-loading">{t('split.loading')}</p>
      ) : expenses.length === 0 ? (
        <p className="split-loading">{t('split.noExpenses')}</p>
      ) : (
        <>
          {(showAllExpenses ? expenses : expenses.slice(0, 5)).map(e => (
            <SplitExpenseItem key={e.id} expense={e} members={members} onEdit={(exp) => { setEditingExpense(exp); setAddExpenseOpen(true); }} onDelete={handleDeleteExpense} />
          ))}
          {expenses.length > 5 && (
            <button
              type="button"
              className="split-group-detail__show-more"
              onClick={() => setShowAllExpenses(prev => !prev)}
            >
              {showAllExpenses ? t('split.collapseRecords') : t('split.viewAllRecords', { n: expenses.length })}
            </button>
          )}
        </>
      )}

      {/* Per person spend */}
      {expenses.length > 0 && (
        <>
          <div className="split-group-detail__section-header split-group-detail__section-header--summary">
            <p className="split-group-detail__section-title">{t('split.perPersonSpend')}</p>
          </div>
          <div className="split-member-totals">
            {members.map(m => (
              <div key={m.id} className="split-member-totals__row">
                <span className="split-member-totals__avatar">
                  {m.avatar_url
                    ? <img src={m.avatar_url} alt={m.name} />
                    : m.name.charAt(0)
                  }
                </span>
                <span className="split-member-totals__name">{m.name}</span>
                <span className="split-member-totals__amount">
                  {cur} {fmtAmt(memberTotals[m.id] || 0)}
                </span>
              </div>
            ))}
          </div>

          <div className="split-group-detail__section-header split-group-detail__section-header--summary">
            <p className="split-group-detail__section-title">{t('split.settlement')}</p>
          </div>
          <SplitSettlement
            transactions={settlement}
            currency={group.currency}
            onSettle={handleSettle}
            settlementHistory={settlementHistory}
            onDeleteSettlement={handleDeleteSettlement}
          />
        </>
      )}

      {/* Sync to ledger */}
      {actorMember && (
        <>
          <div className="split-group-detail__section-header split-group-detail__section-header--summary">
            <p className="split-group-detail__section-title">{t('split.syncSection')}</p>
          </div>
          <div className="split-sync-box">
            {!syncStatus || !syncStatus.synced ? (
              <div className="split-sync-box__unsync">
                <p className="split-sync-box__desc">
                  {t('split.syncDesc', {
                    currency: syncStatus?.currency || group.currency || 'TWD',
                    amount: fmtAmt(syncStatus?.current_total ?? memberTotals[actorMember.id] ?? 0),
                  })}
                </p>
                <button
                  type="button"
                  className="split-sync-box__btn split-sync-box__btn--primary"
                  onClick={handleSyncToLedger}
                  disabled={syncing}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                  </svg>
                  {syncing ? t('split.syncing') : t('split.syncBtn')}
                </button>
              </div>
            ) : syncStatus.needs_update ? (
              <div className="split-sync-box__needs-update">
                <div className="split-sync-box__update-info">
                  <span className="split-sync-box__dot" />
                  <span className="split-sync-box__update-text">{t('split.hasNewExpenses')}</span>
                </div>
                <p className="split-sync-box__desc">
                  {t('split.ledgerRecord')}{syncStatus.currency} {fmtAmt(syncStatus.synced_amount)}　→　{t('split.latest')}{syncStatus.currency} {fmtAmt(syncStatus.current_total)}
                </p>
                <div className="split-sync-box__actions">
                  <button
                    type="button"
                    className="split-sync-box__btn split-sync-box__btn--primary"
                    onClick={handleSyncToLedger}
                    disabled={syncing}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                    </svg>
                    {syncing ? t('split.updating') : t('split.updateSync')}
                  </button>
                  <button type="button" className="split-sync-box__btn split-sync-box__btn--secondary" onClick={() => setShareDetailOpen(true)}>
                    {t('split.viewDetail')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="split-sync-box__synced">
                <div className="split-sync-box__synced-info">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="split-sync-box__check-icon" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                  <span className="split-sync-box__synced-label">{t('split.synced')}</span>
                  <span className="split-sync-box__synced-amount">{syncStatus.currency} {fmtAmt(syncStatus.synced_amount)}</span>
                </div>
                <div className="split-sync-box__actions">
                  <button
                    type="button"
                    className="split-sync-box__btn split-sync-box__btn--secondary"
                    onClick={handleSyncToLedger}
                    disabled={syncing}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                    </svg>
                    {syncing ? t('split.updating') : t('split.resync')}
                  </button>
                  <button type="button" className="split-sync-box__btn split-sync-box__btn--secondary" onClick={() => setShareDetailOpen(true)}>
                    {t('split.viewDetail')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <SplitShareDetailModal
        isOpen={shareDetailOpen}
        onClose={() => setShareDetailOpen(false)}
        snapshot={syncStatus?.expense_snapshot || []}
        groupName={group.name}
        currency={syncStatus?.currency || group.currency || 'TWD'}
        totalAmount={syncStatus?.synced_amount || 0}
      />

      <AddExpenseModal
        isOpen={addExpenseOpen}
        onClose={() => { setAddExpenseOpen(false); setEditingExpense(null); }}
        onAdd={handleAddExpense}
        onUpdate={handleUpdateExpense}
        editingExpense={editingExpense}
        members={members}
        groupCurrency={group.currency || 'TWD'}
        defaultExpenseCurrency={group.default_expense_currency || group.currency || 'TWD'}
        currencies={currencies}
      />

      <ManageMembersModal
        isOpen={addMembersOpen}
        onClose={() => setAddMembersOpen(false)}
        members={members}
        currentUserId={user?.id}
        onAddMembers={async (names) => {
          for (const name of names) {
            await onAddMember(group.id, name);
          }
        }}
        onRemoveMember={onRemoveMember}
        onUpdateMemberName={onUpdateMemberName}
      />

      <GroupSettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSettingsSave}
        group={group}
        currencies={currencies}
      />
    </>
  );
}
