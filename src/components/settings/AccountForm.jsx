import { useState, useEffect } from 'react';
import { ACCOUNT_TYPE_NAMES } from '@/lib/constants';

const EMPTY_FORM = { name: '', type: '', creditLimit: '', billingDay: '', paymentDueDay: '', error: '' };

export default function AccountForm({ account, onSave, onCancel, loading }) {
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    if (account) {
      setForm({
        name: account.name || '',
        type: account.type || '',
        creditLimit: account.credit_limit != null ? String(account.credit_limit) : '',
        billingDay: account.billing_day != null ? String(account.billing_day) : '',
        paymentDueDay: account.payment_due_day != null ? String(account.payment_due_day) : '',
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [account]);

  const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.type) {
      setForm((f) => ({ ...f, error: '請填寫必填欄位！' }));
      return;
    }
    setForm((f) => ({ ...f, error: '' }));
    const payload = {
      name: form.name.trim(),
      type: form.type,
      credit_limit: form.creditLimit ? parseFloat(form.creditLimit) : null,
      billing_day: form.billingDay ? parseInt(form.billingDay, 10) : null,
      payment_due_day: form.paymentDueDay ? parseInt(form.paymentDueDay, 10) : null,
    };
    await onSave(payload, account?.id || null);
  };

  return (
    <div className="account-form">
      <h4 className="account-form__title">{account ? '編輯帳戶' : '新增帳戶'}</h4>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-group__label">帳戶名稱 *</label>
          <input className="form-group__input" type="text" value={form.name} onChange={set('name')} required disabled={loading} />
        </div>
        <div className="form-group">
          <label className="form-group__label">帳戶類型 *</label>
          <select className="form-group__input" value={form.type} onChange={set('type')} required disabled={loading}>
            <option value="" disabled>選擇類型</option>
            {Object.entries(ACCOUNT_TYPE_NAMES).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
        </div>
        {form.type === 'credit_card' && (
          <>
            <div className="form-group">
              <label className="form-group__label">信用額度</label>
              <input className="form-group__input" type="number" min="0" value={form.creditLimit} onChange={set('creditLimit')} disabled={loading} />
            </div>
            <div className="form-group">
              <label className="form-group__label">帳單日（每月幾日）</label>
              <input className="form-group__input" type="number" min="1" max="31" value={form.billingDay} onChange={set('billingDay')} disabled={loading} />
            </div>
            <div className="form-group">
              <label className="form-group__label">繳款日（每月幾日）</label>
              <input className="form-group__input" type="number" min="1" max="31" value={form.paymentDueDay} onChange={set('paymentDueDay')} disabled={loading} />
            </div>
          </>
        )}
        {form.error && (
          <p style={{ color: 'var(--color-danger)', fontSize: '0.875rem', marginBottom: '0.5rem' }}>{form.error}</p>
        )}
        <div className="form-actions">
          <button type="button" className="btn-cancel" onClick={onCancel} disabled={loading}>取消</button>
          <button type="submit" className="btn-save" disabled={loading}>{loading ? '儲存中...' : '儲存'}</button>
        </div>
      </form>
    </div>
  );
}
