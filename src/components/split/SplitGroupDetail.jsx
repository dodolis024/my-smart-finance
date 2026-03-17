import { useEffect, useState } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useSplitExpenses } from '@/hooks/useSplitExpenses';
import SplitExpenseItem from './SplitExpenseItem';
import SplitSettlement from './SplitSettlement';
import AddExpenseModal from './AddExpenseModal';

export default function SplitGroupDetail({ group, onBack, rates, currencies }) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const { expenses, loading, fetchExpenses, addExpense, deleteExpense, calcSettlement } = useSplitExpenses(group.id);
  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { fetchExpenses(); }, [fetchExpenses]);

  const members = group.split_members || [];
  const settlement = calcSettlement(members, expenses, rates, group.currency);

  const handleAddExpense = async (data) => {
    await addExpense(data);
    toast.success('費用已新增！');
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

  return (
    <>
      <div className="split-group-detail__header">
        <p className="split-group-detail__name">{group.name}</p>
        <div className="split-group-detail__members-row">
          {members.map(m => (
            <span key={m.id} className="split-group-detail__member-chip">{m.name}</span>
          ))}
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
          <SplitExpenseItem key={e.id} expense={e} members={members} onDelete={handleDeleteExpense} />
        ))
      )}

      <SplitSettlement transactions={settlement} currency={group.currency} />

      <AddExpenseModal
        isOpen={addExpenseOpen}
        onClose={() => setAddExpenseOpen(false)}
        onAdd={handleAddExpense}
        members={members}
        groupCurrency={group.currency || 'TWD'}
        currencies={currencies}
      />
    </>
  );
}
