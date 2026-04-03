import { useEffect, useState } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useSplitExpenses } from '@/hooks/useSplitExpenses';
import { useSplitSync } from '@/hooks/useSplitSync';
import { useAuth } from '@/hooks/useAuth';
import SplitExpenseItem from './SplitExpenseItem';
import SplitSettlement from './SplitSettlement';
import SplitShareDetailModal from './SplitShareDetailModal';
import AddExpenseModal from './AddExpenseModal';
import ManageMembersModal from './ManageMembersModal';
import GroupSettingsModal from './GroupSettingsModal';

export default function SplitGroupDetail({ group, onBack, rates, currencies, onAddMember, onRemoveMember, onUpdateMemberName, onUpdateGroup }) {
  const toast = useToast();
  const { confirm } = useConfirm();
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
    toast.success('群組設定已更新！');
  };

  useEffect(() => { fetchExpenses(); }, [fetchExpenses]);
  useEffect(() => { if (actorMember) fetchSyncStatus(); }, [fetchSyncStatus, actorMember]);

  const members = group.split_members || [];
  const settlement = calcSettlement(members, expenses, settlements, rates, group.currency);

  // 每人分攤總額
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
    toast.success('費用已新增！');
    if (actorMember) fetchSyncStatus();
  };

  const handleUpdateExpense = async (expenseId, data) => {
    await updateExpense(expenseId, data);
    toast.success('費用已更新！');
    if (actorMember) fetchSyncStatus();
  };

  const handleDeleteExpense = async (id) => {
    const ok = await confirm('確定要刪除這筆費用嗎？', { danger: true });
    if (!ok) return;
    try {
      await deleteExpense(id);
      toast.success('已刪除。');
      if (actorMember) fetchSyncStatus();
    } catch {
      toast.error('刪除失敗，請稍後再試。');
    }
  };

  const handleSettle = async (transaction) => {
    const ok = await confirm(
      `確認 ${transaction.from} 已還 ${group.currency || 'TWD'} ${transaction.amount % 1 === 0 ? transaction.amount.toLocaleString() : transaction.amount.toFixed(2)} 給 ${transaction.to}？`,
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
      toast.success('已記錄還款！');
    } catch {
      toast.error('記錄失敗，請稍後再試。');
    }
  };

  const handleDeleteSettlement = async (id) => {
    const ok = await confirm('確定要撤銷這筆還款紀錄嗎？', { danger: true });
    if (!ok) return;
    try {
      await deleteSettlement(id);
      toast.success('已撤銷。');
    } catch {
      toast.error('撤銷失敗，請稍後再試。');
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
      toast.success('代碼已複製！');
    });
  };

  const handleSyncToLedger = async () => {
    try {
      const result = await syncToLedger();
      if (result?.is_update) {
        toast.success('帳本已更新！');
      } else {
        toast.success('已同步至個人帳本！');
      }
    } catch (err) {
      toast.error(err?.message || '同步失敗，請稍後再試。');
    }
  };

  // 為還款紀錄帶入成員名稱
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
          <button type="button" className="split-group-detail__edit-name-btn" onClick={() => setSettingsOpen(true)} aria-label="編輯群組設定">
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
            aria-label="管理成員"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" style={{ width: 14, height: 14 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM12.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM18.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
            </svg>
          </button>
        </div>
      </div>

      {/* 邀請資訊 */}
      <div className="split-group-detail__invite">
        <span className="split-group-detail__invite-label">邀請代碼</span>
        <span className="split-group-detail__invite-code" onClick={handleCopyCode} style={{ cursor: 'pointer' }} title="點擊複製代碼">
          {group.invite_code}
        </span>
        <button type="button" className="split-group-detail__invite-copy" onClick={handleCopyLink}>
          {copied ? '已複製 ✓' : '複製連結'}
        </button>
      </div>

      {/* 費用列表 */}
      <div className="split-group-detail__section-header">
        <p className="split-group-detail__section-title">費用紀錄</p>
        <button type="button" className="split-btn-secondary" style={{ width: 'auto', padding: '0.4rem 0.85rem', fontSize: '0.82rem' }} onClick={() => setAddExpenseOpen(true)}>
          ＋ 新增費用
        </button>
      </div>

      {loading ? (
        <p className="split-loading">載入中...</p>
      ) : expenses.length === 0 ? (
        <p className="split-loading">尚無費用，點上方按鈕新增第一筆！</p>
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
              {showAllExpenses ? '收合紀錄' : `查看全部紀錄（共 ${expenses.length} 筆）`}
            </button>
          )}
        </>
      )}

      {/* 每人花費 */}
      {expenses.length > 0 && (
        <>
          <div className="split-group-detail__section-header split-group-detail__section-header--summary">
            <p className="split-group-detail__section-title">每人花費</p>
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
            <p className="split-group-detail__section-title">結算</p>
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

      {/* 同步至個人帳本 */}
      {actorMember && (
        <>
          <div className="split-group-detail__section-header split-group-detail__section-header--summary">
            <p className="split-group-detail__section-title">同步至帳本</p>
          </div>
          <div className="split-sync-box">
            {!syncStatus || !syncStatus.synced ? (
              <div className="split-sync-box__unsync">
                <p className="split-sync-box__desc">
                  將你在此群組的分攤支出（共 <strong>{syncStatus?.currency || group.currency || 'TWD'} {fmtAmt(syncStatus?.current_total ?? memberTotals[actorMember.id] ?? 0)}</strong>）新增至個人帳本。
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
                  {syncing ? '同步中...' : '同步至帳本'}
                </button>
              </div>
            ) : syncStatus.needs_update ? (
              <div className="split-sync-box__needs-update">
                <div className="split-sync-box__update-info">
                  <span className="split-sync-box__dot" />
                  <span className="split-sync-box__update-text">有新費用，帳本尚未更新</span>
                </div>
                <p className="split-sync-box__desc">
                  帳本記錄：{syncStatus.currency} {fmtAmt(syncStatus.synced_amount)}　→　最新：{syncStatus.currency} {fmtAmt(syncStatus.current_total)}
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
                    {syncing ? '更新中...' : '更新同步'}
                  </button>
                  <button type="button" className="split-sync-box__btn split-sync-box__btn--secondary" onClick={() => setShareDetailOpen(true)}>
                    查看明細
                  </button>
                </div>
              </div>
            ) : (
              <div className="split-sync-box__synced">
                <div className="split-sync-box__synced-info">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="split-sync-box__check-icon" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                  <span className="split-sync-box__synced-label">已同步至帳本</span>
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
                    {syncing ? '更新中...' : '重新同步'}
                  </button>
                  <button type="button" className="split-sync-box__btn split-sync-box__btn--secondary" onClick={() => setShareDetailOpen(true)}>
                    查看明細
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
