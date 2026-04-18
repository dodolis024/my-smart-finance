import { useState } from 'react';
import AccountForm from './AccountForm';
import { formatMoney } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';

export default function AccountManager({ accounts, onSave, onDelete, loading, confirm, onError }) {
  const { t } = useLanguage();
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
      onError?.(err.message || t('common.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (account) => {
    const ok = await confirm(t('settings.account.deleteConfirm', { name: account.name }), { danger: true });
    if (!ok) return;
    try {
      await onDelete(account.id);
    } catch (err) {
      onError?.(err.message || t('common.deleteFailed'));
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
        <button type="button" className="btn-add-account" onClick={handleAdd} disabled={loading}>{t('settings.account.addBtn')}</button>
      </div>
      {accounts.length === 0 ? (
        <p className="account-manager__empty">{t('settings.account.noAccounts')}</p>
      ) : (
        <div className="accounts-list">
          {accounts.map((account) => {
            const typeName = t(`settings.account.typeNames.${account.type}`) || account.type;
            return (
              <div key={account.id} className="account-item">
                <div className="account-item__header">
                  <span className="account-item__name">{account.name}</span>
                  <div className="account-item__actions">
                    <button type="button" className="account-item__btn" disabled={loading} onClick={() => handleEdit(account)}>{t('common.edit')}</button>
                    <button type="button" className="account-item__btn account-item__btn--delete" disabled={loading} onClick={() => handleDelete(account)}>{t('common.delete')}</button>
                  </div>
                </div>
                <div className="account-item__details">
                  <div className="account-item__detail">{t('settings.account.typeDetail')}{typeName}</div>
                  {account.type === 'credit_card' && (
                    <>
                      {account.credit_limit && <div className="account-item__detail">{t('settings.account.creditLimitDetail')}{formatMoney(account.credit_limit)}</div>}
                      {account.billing_day && <div className="account-item__detail">{t('settings.account.billingDayDetail', { day: account.billing_day })}</div>}
                      {account.payment_due_day && <div className="account-item__detail">{t('settings.account.paymentDueDayDetail', { day: account.payment_due_day })}</div>}
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
