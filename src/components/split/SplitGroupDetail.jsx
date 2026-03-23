import { useEffect, useState, useRef } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useSplitExpenses } from '@/hooks/useSplitExpenses';
import { useAuth } from '@/hooks/useAuth';
import SplitExpenseItem from './SplitExpenseItem';
import SplitSettlement from './SplitSettlement';
import AddExpenseModal from './AddExpenseModal';
import ManageMembersModal from './ManageMembersModal';

export default function SplitGroupDetail({ group, onBack, rates, currencies, onAddMember, onRemoveMember, onUpdateGroup }) {
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
  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [addMembersOpen, setAddMembersOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(group.name);
  const nameInputRef = useRef(null);

  useEffect(() => { setNameValue(group.name); }, [group.name]);

  const handleNameSave = async () => {
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === group.name) {
      setNameValue(group.name);
      setEditingName(false);
      return;
    }
    try {
      await onUpdateGroup(group.id, { name: trimmed });
      setEditingName(false);
    } catch {
      toast.error('更新名稱失敗，請稍後再試。');
      setNameValue(group.name);
      setEditingName(false);
    }
  };

  const startEditName = () => {
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.focus(), 0);
  };

  useEffect(() => { fetchExpenses(); }, [fetchExpenses]);

  const members = group.split_members || [];
  const settlement = calcSettlement(members, expenses, settlements, rates, group.currency);

  const handleAddExpense = async (data) => {
    await addExpense(data);
    toast.success('費用已新增！');
  };

  const handleUpdateExpense = async (expenseId, data) => {
    await updateExpense(expenseId, data);
    toast.success('費用已更新！');
  };

  const handleDeleteExpense = async (id) => {
    const ok = await confirm('確定要刪除這筆費用嗎？', { danger: true });
    if (!ok) return;
    try {
      await deleteExpense(id);
      toast.success('已刪除。');
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
          {editingName ? (
            <>
              <input
                ref={nameInputRef}
                className="split-group-detail__name-input"
                value={nameValue}
                onChange={e => setNameValue(e.target.value)}
                onBlur={() => setTimeout(handleNameSave, 100)}
                onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { setNameValue(group.name); setEditingName(false); } }}
                maxLength={50}
              />
              <button type="button" className="split-group-detail__name-confirm" onMouseDown={e => e.preventDefault()} onClick={handleNameSave} aria-label="確認">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              </button>
            </>
          ) : (
            <>
              <p className="split-group-detail__name">{group.name}</p>
              <button type="button" className="split-group-detail__edit-name-btn" onClick={startEditName} aria-label="編輯群組名稱">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                </svg>
              </button>
            </>
          )}
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
        expenses.map(e => (
          <SplitExpenseItem key={e.id} expense={e} members={members} onEdit={(exp) => { setEditingExpense(exp); setAddExpenseOpen(true); }} onDelete={handleDeleteExpense} />
        ))
      )}

      <SplitSettlement
        transactions={settlement}
        currency={group.currency}
        onSettle={handleSettle}
        settlementHistory={settlementHistory}
        onDeleteSettlement={handleDeleteSettlement}
      />

      <AddExpenseModal
        isOpen={addExpenseOpen}
        onClose={() => { setAddExpenseOpen(false); setEditingExpense(null); }}
        onAdd={handleAddExpense}
        onUpdate={handleUpdateExpense}
        editingExpense={editingExpense}
        members={members}
        groupCurrency={group.currency || 'TWD'}
        currencies={currencies}
      />

      <ManageMembersModal
        isOpen={addMembersOpen}
        onClose={() => setAddMembersOpen(false)}
        members={members}
        onAddMembers={async (names) => {
          for (const name of names) {
            await onAddMember(group.id, name);
          }
        }}
        onRemoveMember={onRemoveMember}
      />
    </>
  );
}
