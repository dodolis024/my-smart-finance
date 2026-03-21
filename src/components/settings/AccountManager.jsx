import { useState } from 'react';
import AccountForm from './AccountForm';
import { ACCOUNT_TYPE_NAMES } from '@/lib/constants';
import { formatMoney } from '@/lib/utils';

export default function AccountManager({ accounts, onSave, onDelete, loading, confirm, onError }) {
  const [editingAccount, setEditingAccount] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleEdit = (account) => {
    setEditingAccount(account);
    setShowForm(true);
  };

  const handleAdd = () => {
    setEditingAccount(null);
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingAccount(null);
  };

  const handleSave = async (payload, id) => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(payload, id);
      setShowForm(false);
      setEditingAccount(null);
    } catch (err) {
      onError?.(err.message || '儲存失敗，請稍後再試。');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (account) => {
    const ok = await confirm(
      `確定要刪除帳戶「${account.name}」嗎？\n注意：既有交易的支付方式名稱會保留，但帳戶連結會移除。`,
      { danger: true }
    );
    if (!ok) return;
    try {
      await onDelete(account.id);
    } catch (err) {
      onError?.(err.message || '刪除失敗，請稍後再試。');
    }
  };

  if (showForm) {
    return (
      <AccountForm
        account={editingAccount}
        onSave={handleSave}
        onCancel={handleCancel}
        loading={loading || saving}
      />
    );
  }

  return (
    <div className="account-manager">
      <div className="accounts-header">
        <button type="button" className="btn-add-account" onClick={handleAdd} disabled={loading}>+ 新增</button>
      </div>
      {accounts.length === 0 ? (
        <p className="account-manager__empty">尚無帳戶，請新增帳戶。</p>
      ) : (
        <div className="accounts-list">
          {accounts.map((account) => {
            const typeName = ACCOUNT_TYPE_NAMES[account.type] || account.type;
            return (
              <div key={account.id} className="account-item">
                <div className="account-item__header">
                  <span className="account-item__name">{account.name}</span>
                  <div className="account-item__actions">
                    <button type="button" className="account-item__btn" disabled={loading} onClick={() => handleEdit(account)}>編輯</button>
                    <button type="button" className="account-item__btn account-item__btn--delete" disabled={loading} onClick={() => handleDelete(account)}>刪除</button>
                  </div>
                </div>
                <div className="account-item__details">
                  <div className="account-item__detail">類型：{typeName}</div>
                  {account.type === 'credit_card' && (
                    <>
                      {account.credit_limit && <div className="account-item__detail">信用額度：{formatMoney(account.credit_limit)}</div>}
                      {account.billing_day && <div className="account-item__detail">帳單日：每月 {account.billing_day} 日</div>}
                      {account.payment_due_day && <div className="account-item__detail">繳款日：每月 {account.payment_due_day} 日</div>}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
