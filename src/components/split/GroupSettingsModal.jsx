import { useState, useEffect } from 'react';
import Modal from '@/components/common/Modal';

export default function GroupSettingsModal({ isOpen, onClose, onSave, group, currencies = [] }) {
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
    if (!name.trim()) { setError('請填寫群組名稱'); return; }
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
      setError(err.message || '儲存失敗，請稍後再試');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} className="split-modal" titleId="group-settings-title">
      <div className="reminder-modal__backdrop" onClick={handleClose} />
      <div className="split-modal__dialog" onClick={e => e.stopPropagation()}>
        <button type="button" className="reminder-modal__close" aria-label="關閉" onClick={handleClose}>×</button>
        <h2 id="group-settings-title" className="split-modal__title">群組設定</h2>

        <div className="split-modal__field">
          <label className="split-modal__label" htmlFor="settings-group-name">群組名稱</label>
          <input
            id="settings-group-name"
            className="split-modal__input"
            placeholder="例：墾丁旅遊"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>

        <div className="split-modal__field">
          <label className="split-modal__label" htmlFor="settings-expense-currency">預設記錄幣別</label>
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
          <label className="split-modal__label" htmlFor="settings-group-currency">結算幣別</label>
          <select
            id="settings-group-currency"
            className="split-modal__select"
            value={currency}
            onChange={e => setCurrency(e.target.value)}
          >
            <option value="">同記錄幣別</option>
            {currencies.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {error && <p className="split-modal__error">{error}</p>}

        <div className="split-modal__actions">
          <button type="button" className="split-btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? '儲存中...' : '儲存設定'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
