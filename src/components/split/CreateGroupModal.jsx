import { useState } from 'react';
import Modal from '@/components/common/Modal';
import { useLanguage } from '@/contexts/LanguageContext';

let nextMemberId = 1;

export default function CreateGroupModal({ isOpen, onClose, onCreate, currencies = ['TWD', 'USD', 'JPY', 'EUR', 'GBP'] }) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [myName, setMyName] = useState('');
  const [currency, setCurrency] = useState('');
  const [defaultExpenseCurrency, setDefaultExpenseCurrency] = useState('TWD');
  const [members, setMembers] = useState(() => [{ id: nextMemberId++, value: '' }, { id: nextMemberId++, value: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleClose = () => {
    setName(''); setMyName(''); setCurrency(''); setDefaultExpenseCurrency('TWD');
    setMembers([{ id: nextMemberId++, value: '' }, { id: nextMemberId++, value: '' }]);
    setError('');
    onClose();
  };

  const addMember = () => setMembers(prev => [...prev, { id: nextMemberId++, value: '' }]);
  const removeMember = (i) => setMembers(prev => prev.filter((_, idx) => idx !== i));
  const updateMember = (i, val) => setMembers(prev => prev.map((m, idx) => idx === i ? { ...m, value: val } : m));

  const handleSubmit = async () => {
    if (!name.trim()) { setError(t('split.groupNameRequired')); return; }
    if (!myName.trim()) { setError(t('split.myNameRequired')); return; }
    setError('');
    setSaving(true);
    try {
      await onCreate({
        name: name.trim(),
        myName: myName.trim(),
        currency: currency || defaultExpenseCurrency,
        defaultExpenseCurrency,
        extraMembers: members.map(m => m.value).filter(v => v.trim()),
      });
      handleClose();
    } catch (err) {
      setError(err.message || t('common.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} className="split-modal" titleId="create-group-title">
      <div className="reminder-modal__backdrop" onClick={handleClose} />
      <div className="split-modal__dialog" onClick={e => e.stopPropagation()}>
        <button type="button" className="reminder-modal__close" aria-label={t('common.close')} onClick={handleClose}>×</button>
        <h2 id="create-group-title" className="split-modal__title">{t('split.createGroupTitle')}</h2>

        <div className="split-modal__field">
          <label className="split-modal__label" htmlFor="group-name">{t('split.groupNameLabel')}</label>
          <input
            id="group-name"
            className="split-modal__input"
            placeholder="e.g. Kenting Trip"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>

        <div className="split-modal__field">
          <label className="split-modal__label" htmlFor="group-expense-currency">{t('split.defaultCurrencyLabel')}</label>
          <select
            id="group-expense-currency"
            className="split-modal__select"
            value={defaultExpenseCurrency}
            onChange={e => setDefaultExpenseCurrency(e.target.value)}
          >
            {currencies.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="split-modal__field">
          <label className="split-modal__label" htmlFor="group-currency">{t('split.settlementCurrencyLabel')}</label>
          <select
            id="group-currency"
            className="split-modal__select"
            value={currency}
            onChange={e => setCurrency(e.target.value)}
          >
            <option value="">{t('split.sameCurrency')}</option>
            {currencies.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="split-modal__field">
          <label className="split-modal__label" htmlFor="my-name">{t('split.yourNameInGroup')}</label>
          <input
            id="my-name"
            className="split-modal__input"
            placeholder="e.g. Doris"
            value={myName}
            onChange={e => setMyName(e.target.value)}
          />
        </div>

        <div className="split-modal__field">
          <label className="split-modal__label">{t('split.otherMembers')}</label>
          <div className="split-modal__members-list">
            {members.map((m, i) => (
              <div key={m.id} className="split-modal__member-row">
                <input
                  className="split-modal__input"
                  placeholder={t('split.memberNamePlaceholder', { n: i + 1 })}
                  value={m.value}
                  onChange={e => updateMember(i, e.target.value)}
                />
                <button type="button" className="split-modal__member-remove" onClick={() => removeMember(i)} aria-label={t('common.delete')}>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="split-modal__add-member-btn" onClick={addMember}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" style={{ width: 15, height: 15 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            {t('split.addMemberBtn')}
          </button>
        </div>

        {error && <p className="split-modal__error">{error}</p>}

        <div className="split-modal__actions">
          <button type="button" className="split-btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? t('split.creating') : t('split.createGroup')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
