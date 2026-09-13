import { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { OVERSEAS_FEE_ACCOUNT_TYPES } from '@/lib/overseasFee';

const ACCOUNT_TYPE_KEYS = ['cash', 'credit_card', 'debit_card', 'digital_wallet', 'bank'];
const EMPTY_FORM = { name: '', type: '', creditLimit: '', billingDay: '', paymentDueDay: '', balanceAmount: '', overseasFeeRate: '', overseasAutoCheck: true, error: '' };

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
        balanceAmount: account.balance_amount != null ? String(account.balance_amount) : '',
        overseasFeeRate: account.overseas_fee_rate != null ? String(Number(account.overseas_fee_rate)) : '',
        overseasAutoCheck: account.overseas_fee_auto_check !== false,
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [account]);

  const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));
  const setChecked = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.checked }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.type) {
      setForm((f) => ({ ...f, error: t('settings.account.requiredFieldError') }));
      return;
    }
    const supportsFee = OVERSEAS_FEE_ACCOUNT_TYPES.includes(form.type);
    const feeRate = supportsFee && form.overseasFeeRate !== '' ? parseFloat(form.overseasFeeRate) : null;
    if (feeRate != null && (!Number.isFinite(feeRate) || feeRate < 0 || feeRate > 10)) {
      setForm((f) => ({ ...f, error: t('settings.account.overseasFeeRateError') }));
      return;
    }
    setForm((f) => ({ ...f, error: '' }));
    // 餘額只給非信用卡帳戶：信用卡看的是額度，跟著帳單週期走（見 lib/creditCard.js）
    const balanceAmount = form.type !== 'credit_card' && form.balanceAmount !== ''
      ? parseFloat(form.balanceAmount)
      : null;
    const prevAmount = account?.balance_amount != null ? parseFloat(account.balance_amount) : null;
    // 金額沒動就保留原本的設定時間；改過（或第一次設）才蓋上現在這一刻。
    // 蓋錯的話餘額會從錯的時間點開始重算，等於把已經扣過的帳再扣一次。
    const balanceChanged = balanceAmount !== prevAmount;
    const payload = {
      name: form.name.trim(),
      type: form.type,
      credit_limit: form.creditLimit ? parseFloat(form.creditLimit) : null,
      billing_day: form.billingDay ? parseInt(form.billingDay, 10) : null,
      payment_due_day: form.paymentDueDay ? parseInt(form.paymentDueDay, 10) : null,
      balance_amount: balanceAmount,
      balance_as_of: balanceAmount == null
        ? null
        : balanceChanged
          ? new Date().toISOString()
          : (account?.balance_as_of ?? new Date().toISOString()),
      // 填 0 等同不收手續費，存 NULL（資料庫 CHECK 要求 > 0）；類型改成不支援的也會存 NULL
      overseas_fee_rate: feeRate > 0 ? feeRate : null,
      overseas_fee_auto_check: Boolean(form.overseasAutoCheck),
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
        {form.type && form.type !== 'credit_card' && (
          <div className="form-group">
            <label className="form-group__label">{t('settings.account.balanceLabel')}</label>
            <input className="form-group__input" type="number" step="0.01" value={form.balanceAmount} onChange={set('balanceAmount')} disabled={loading} />
            <p className="account-form__hint">{t('settings.account.balanceHint')}</p>
          </div>
        )}
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
        {OVERSEAS_FEE_ACCOUNT_TYPES.includes(form.type) && (
          <>
            <div className="form-group">
              <label className="form-group__label">{t('settings.account.overseasFeeRateLabel')}</label>
              <input className="form-group__input" type="number" min="0" max="10" step="0.01" inputMode="decimal"
                placeholder="1.5" value={form.overseasFeeRate} onChange={set('overseasFeeRate')} disabled={loading} />
              <p className="account-form__hint">{t('settings.account.overseasFeeRateHint')}</p>
            </div>
            {parseFloat(form.overseasFeeRate) > 0 && (
              <div className="form-group">
                <label className="account-form__checkbox">
                  <input type="checkbox" checked={form.overseasAutoCheck} onChange={setChecked('overseasAutoCheck')} disabled={loading} />
                  <span>{t('settings.account.overseasAutoCheckLabel')}</span>
                </label>
              </div>
            )}
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
