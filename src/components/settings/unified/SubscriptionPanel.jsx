import { useState, useEffect } from 'react';
import { useSettings } from '@/hooks/useSettings';
import { useDashboard } from '@/hooks/useDashboard';
import { useSubscriptions } from '@/hooks/useSubscriptions';
import { useLanguage } from '@/contexts/LanguageContext';

const EMPTY_FORM = { name: '', amount: '', currency: 'TWD', category: '', payment_method: '', renewal_day: 1 };

export default function SubscriptionPanel({ isOpen, confirm, toast }) {
  const { t } = useLanguage();
  const { categoriesExpense, accounts } = useSettings();
  const { currencies } = useDashboard();
  const { subscriptions, loading, loadSubscriptions, saveSubscription, deleteSubscription, toggleSubscription } = useSubscriptions();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) { loadSubscriptions(); setShowForm(false); setEditingId(null); }
  }, [isOpen, loadSubscriptions]);

  const setField = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const handleOpenAdd = () => { setForm(EMPTY_FORM); setEditingId(null); setShowForm(true); };
  const handleOpenEdit = (sub) => {
    setForm({ name: sub.name, amount: String(sub.amount), currency: sub.currency || 'TWD', category: sub.category || '', payment_method: sub.payment_method || '', renewal_day: sub.renewal_day });
    setEditingId(sub.id);
    setShowForm(true);
  };
  const handleCancel = () => { setShowForm(false); setEditingId(null); };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error(t('settings.subscription.nameRequired')); return; }
    const amount = parseFloat(form.amount);
    if (isNaN(amount) || amount <= 0) { toast.error(t('settings.subscription.invalidAmount')); return; }
    const renewal_day = parseInt(form.renewal_day, 10);
    if (renewal_day < 1 || renewal_day > 31) { toast.error(t('settings.subscription.invalidRenewalDay')); return; }
    setSaving(true);
    try {
      const result = await saveSubscription({ name: form.name.trim(), amount, currency: form.currency, category: form.category || null, payment_method: form.payment_method || null, renewal_day, is_active: true }, editingId);
      if (editingId) { toast.success(t('settings.subscription.subscriptionUpdated')); }
      else if (result?.transactionCreated) { toast.success(t('settings.subscription.subscriptionAddedWithTx')); }
      else { toast.success(t('settings.subscription.subscriptionAdded')); }
      setShowForm(false); setEditingId(null);
    } catch (err) {
      toast.error(err.message || t('common.saveFailed'));
    } finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    const ok = await confirm(t('settings.subscription.deleteConfirm'), { danger: true });
    if (!ok) return;
    try { await deleteSubscription(id); toast.success(t('settings.subscription.subscriptionDeleted')); }
    catch (err) { toast.error(err.message || t('common.deleteFailed')); }
  };

  const handleToggle = async (id, current) => {
    try { await toggleSubscription(id, !current); }
    catch (err) { toast.error(err.message || t('common.updateFailed')); }
  };

  return (
    <div className="usm-panel">
      <h3 className="settings-manage__section-title">{t('settings.subscription.sectionTitle')}</h3>
      {loading ? <p className="subscription-modal__loading">{t('common.loadingDots')}</p>
        : showForm ? (
          <div className="subscription-form">
            <div className="subscription-form__field">
              <label className="subscription-form__label" htmlFor="sub-name">{t('settings.subscription.nameLabel')}</label>
              <input id="sub-name" type="text" className="subscription-form__input" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="e.g. Netflix" maxLength={50} />
            </div>
            <div className="subscription-form__row">
              <div className="subscription-form__field subscription-form__field--fixed">
                <label className="subscription-form__label" htmlFor="sub-currency">{t('settings.subscription.currencyLabel')}</label>
                <select id="sub-currency" className="subscription-form__select" value={form.currency} onChange={(e) => setField('currency', e.target.value)}>
                  {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="subscription-form__field subscription-form__field--grow">
                <label className="subscription-form__label" htmlFor="sub-amount">{t('settings.subscription.amountLabel')}</label>
                <input id="sub-amount" type="number" className="subscription-form__input" value={form.amount} onChange={(e) => setField('amount', e.target.value)} placeholder="0" min="0" />
              </div>
            </div>
            <div className="subscription-form__row">
              <div className="subscription-form__field subscription-form__field--grow">
                <label className="subscription-form__label" htmlFor="sub-category">{t('settings.subscription.categoryLabel')}</label>
                <select id="sub-category" className="subscription-form__select" value={form.category} onChange={(e) => setField('category', e.target.value)}>
                  <option value="">{t('settings.subscription.selectCategory')}</option>
                  {categoriesExpense.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="subscription-form__field subscription-form__field--grow">
                <label className="subscription-form__label" htmlFor="sub-payment">{t('settings.subscription.paymentLabel')}</label>
                <select id="sub-payment" className="subscription-form__select" value={form.payment_method} onChange={(e) => setField('payment_method', e.target.value)}>
                  <option value="">{t('settings.subscription.selectPayment')}</option>
                  {accounts.map((a) => <option key={a.id} value={a.accountName ?? a.name}>{a.accountName ?? a.name}</option>)}
                </select>
              </div>
            </div>
            <div className="subscription-form__field">
              <label className="subscription-form__label" htmlFor="sub-day">{t('settings.subscription.renewalDayLabel')}</label>
              <div className="subscription-form__day-row">
                <input id="sub-day" type="number" className="subscription-form__input subscription-form__input--day" value={form.renewal_day} onChange={(e) => setField('renewal_day', e.target.value)} min="1" max="31" />
                <span className="subscription-form__day-hint">{t('settings.subscription.renewalDayHint')}</span>
              </div>
            </div>
            <div className="subscription-form__actions">
              <button type="button" className="subscription-form__cancel-btn" onClick={handleCancel} disabled={saving}>{t('settings.subscription.cancel')}</button>
              <button type="button" className="subscription-form__save-btn" onClick={handleSave} disabled={saving}>{saving ? t('settings.subscription.saving') : t('settings.subscription.save')}</button>
            </div>
          </div>
        ) : (
          <div className="subscription-list">
            {subscriptions.length === 0 ? (
              <p className="subscription-list__empty">{t('settings.subscription.noSubscriptions')}</p>
            ) : (
              <ul className="subscription-list__items">
                {subscriptions.map((sub) => (
                  <li key={sub.id} className={`subscription-item${!sub.is_active ? ' subscription-item--inactive' : ''}`}>
                    <div className="subscription-item__main">
                      <span className="subscription-item__name">{sub.name}</span>
                      <span className="subscription-item__meta">{sub.currency} {Number(sub.amount).toLocaleString()} · {t('settings.subscription.monthlyOn', { day: sub.renewal_day })}</span>
                      {sub.payment_method && <span className="subscription-item__payment">{sub.payment_method}</span>}
                    </div>
                    <div className="subscription-item__actions">
                      <button type="button" role="switch" aria-checked={sub.is_active} className={`subscription-item__toggle${sub.is_active ? ' is-on' : ''}`} onClick={() => handleToggle(sub.id, sub.is_active)} aria-label={sub.is_active ? t('settings.subscription.disable') : t('settings.subscription.enable')}>
                        <span className="subscription-item__toggle-knob" />
                      </button>
                      <button type="button" className="subscription-item__edit-btn" onClick={() => handleOpenEdit(sub)} aria-label={t('common.edit')}>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" /></svg>
                      </button>
                      <button type="button" className="subscription-item__delete-btn" onClick={() => handleDelete(sub.id)} aria-label={t('common.delete')}>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="subscription-list__footer">
              <button type="button" className="subscription-list__add-btn" onClick={handleOpenAdd}>{t('settings.subscription.addBtn')}</button>
            </div>
          </div>
        )}
    </div>
  );
}
