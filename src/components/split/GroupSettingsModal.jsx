import { useState, useEffect } from 'react';
import Modal from '@/components/common/Modal';
import { useLanguage } from '@/contexts/LanguageContext';

export default function GroupSettingsModal({ isOpen, onClose, onSave, group, currencies = [] }) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('');
  const [defaultExpenseCurrency, setDefaultExpenseCurrency] = useState('TWD');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const initFromGroup = (g) => {
    if (!g) return;
    const expCur = g.default_expense_currency || g.currency || 'TWD';
    setName(g.name ?? '');
    setDefaultExpenseCurrency(expCur);
    setCurrency(g.currency && g.currency !== expCur ? g.currency : '');
    setError('');
  };

  useEffect(() => {
    if (isOpen) initFromGroup(group);
  }, [isOpen, group]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = () => {
    initFromGroup(group);
    onClose();
  };

  const handleSubmit = async () => {
    if (!name.trim()) { setError(t('split.groupNameRequired')); return; }
    setError('');
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        currency: currency || defaultExpenseCurrency,
        defaultExpenseCurrency,
      });
      onClose();
    } catch (err) {
      setError(err.message || t('common.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} className="split-modal" titleId="group-settings-title">
      <div className="reminder-modal__backdrop" onClick={handleClose} />
      <div className="split-modal__dialog" onClick={e => e.stopPropagation()}>
        <button type="button" className="reminder-modal__close" aria-label={t('common.close')} onClick={handleClose}>×</button>
        <h2 id="group-settings-title" className="split-modal__title">{t('split.groupSettings')}</h2>

        <div className="split-modal__field">
          <label className="split-modal__label" htmlFor="settings-group-name">{t('split.groupNameLabel')}</label>
          <input
            id="settings-group-name"
            className="split-modal__input"
            placeholder="e.g. Kenting Trip"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>

        <div className="split-modal__field">
          <label className="split-modal__label" htmlFor="settings-expense-currency">{t('split.defaultCurrencyLabel')}</label>
          <select
            id="settings-expense-currency"
            className="split-modal__select"
            value={defaultExpenseCurrency}
            onChange={e => setDefaultExpenseCurrency(e.target.value)}
          >
            {currencies.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="split-modal__field">
          <label className="split-modal__label" htmlFor="settings-group-currency">{t('split.settlementCurrencyLabel')}</label>
          <select
            id="settings-group-currency"
            className="split-modal__select"
            value={currency}
            onChange={e => setCurrency(e.target.value)}
          >
            <option value="">{t('split.sameCurrency')}</option>
            {currencies.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {error && <p className="split-modal__error">{error}</p>}

        <div className="split-modal__actions">
          <button type="button" className="split-btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? t('common.saving') : t('common.saveSettings')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
