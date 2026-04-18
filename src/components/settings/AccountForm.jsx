import { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';

const ACCOUNT_TYPE_KEYS = ['cash', 'credit_card', 'debit_card', 'digital_wallet', 'bank'];
const EMPTY_FORM = { name: '', type: '', creditLimit: '', billingDay: '', paymentDueDay: '', error: '' };

export default function AccountForm({ account, onSave, onCancel, loading }) {
  const { t } = useLanguage();
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
      setForm((f) => ({ ...f, error: t('settings.account.requiredFieldError') }));
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
      <h4 className="account-form__title">{account ? t('settings.account.editTitle') : t('settings.account.addTitle')}</h4>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-group__label">{t('settings.account.nameLabel')}</label>
          <input className="form-group__input" type="text" value={form.name} onChange={set('name')} required disabled={loading} />
        </div>
        <div className="form-group">
          <label className="form-group__label">{t('settings.account.typeLabel')}</label>
          <select className="form-group__input" value={form.type} onChange={set('type')} required disabled={loading}>
            <option value="" disabled>{t('settings.account.selectType')}</option>
            {ACCOUNT_TYPE_KEYS.map((key) => (
              <option key={key} value={key}>{t(`settings.account.typeNames.${key}`)}</option>
            ))}
          </select>
        </div>
        {form.type === 'credit_card' && (
          <>
            <div className="form-group">
              <label className="form-group__label">{t('settings.account.creditLimitLabel')}</label>
              <input className="form-group__input" type="number" min="0" value={form.creditLimit} onChange={set('creditLimit')} disabled={loading} />
            </div>
            <div className="form-group">
              <label className="form-group__label">{t('settings.account.billingDayLabel')}</label>
              <input className="form-group__input" type="number" min="1" max="31" value={form.billingDay} onChange={set('billingDay')} disabled={loading} />
            </div>
            <div className="form-group">
              <label className="form-group__label">{t('settings.account.paymentDueDayLabel')}</label>
              <input className="form-group__input" type="number" min="1" max="31" value={form.paymentDueDay} onChange={set('paymentDueDay')} disabled={loading} />
            </div>
          </>
        )}
        {form.error && (
          <p style={{ color: 'var(--color-danger)', fontSize: '0.875rem', marginBottom: '0.5rem' }}>{form.error}</p>
        )}
        <div className="form-actions">
          <button type="button" className="btn-cancel" onClick={onCancel} disabled={loading}>{t('common.cancel')}</button>
          <button type="submit" className="btn-save" disabled={loading}>{loading ? t('common.saving') : t('common.save')}</button>
        </div>
      </form>
    </div>
  );
}
