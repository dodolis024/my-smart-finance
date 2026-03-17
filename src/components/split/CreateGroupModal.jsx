import { useState } from 'react';
import Modal from '@/components/common/Modal';

let nextMemberId = 1;

export default function CreateGroupModal({ isOpen, onClose, onCreate, currencies = ['TWD', 'USD', 'JPY', 'EUR', 'GBP'] }) {
  const [name, setName] = useState('');
  const [myName, setMyName] = useState('');
  const [currency, setCurrency] = useState('TWD');
  const [members, setMembers] = useState(() => [{ id: nextMemberId++, value: '' }, { id: nextMemberId++, value: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleClose = () => {
    setName(''); setMyName(''); setCurrency('TWD');
    setMembers([{ id: nextMemberId++, value: '' }, { id: nextMemberId++, value: '' }]);
    setError('');
    onClose();
  };

  const addMember = () => setMembers(prev => [...prev, { id: nextMemberId++, value: '' }]);
  const removeMember = (i) => setMembers(prev => prev.filter((_, idx) => idx !== i));
  const updateMember = (i, val) => setMembers(prev => prev.map((m, idx) => idx === i ? { ...m, value: val } : m));

  const handleSubmit = async () => {
    if (!name.trim()) { setError('請填寫群組名稱'); return; }
    if (!myName.trim()) { setError('請填寫你的名稱'); return; }
    setError('');
    setSaving(true);
    try {
      await onCreate({
        name: name.trim(),
        myName: myName.trim(),
        currency,
        extraMembers: members.map(m => m.value).filter(v => v.trim()),
      });
      handleClose();
    } catch (err) {
      setError(err.message || '建立失敗，請稍後再試');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} className="split-modal" titleId="create-group-title">
      <div className="reminder-modal__backdrop" onClick={handleClose} />
      <div className="split-modal__dialog" onClick={e => e.stopPropagation()}>
        <button type="button" className="reminder-modal__close" aria-label="關閉" onClick={handleClose}>×</button>
        <h2 id="create-group-title" className="split-modal__title">新增分帳群組</h2>

        <div className="split-modal__field">
          <label className="split-modal__label" htmlFor="group-name">群組名稱</label>
          <input
            id="group-name"
            className="split-modal__input"
            placeholder="例：墾丁旅遊"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>

        <div className="split-modal__field">
          <label className="split-modal__label" htmlFor="group-currency">結算幣別</label>
          <select
            id="group-currency"
            className="split-modal__select"
            value={currency}
            onChange={e => setCurrency(e.target.value)}
          >
            {currencies.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="split-modal__field">
          <label className="split-modal__label" htmlFor="my-name">你在群組中的名稱</label>
          <input
            id="my-name"
            className="split-modal__input"
            placeholder="例：Doris"
            value={myName}
            onChange={e => setMyName(e.target.value)}
          />
        </div>

        <div className="split-modal__field">
          <label className="split-modal__label">其他成員</label>
          <div className="split-modal__members-list">
            {members.map((m, i) => (
              <div key={m.id} className="split-modal__member-row">
                <input
                  className="split-modal__input"
                  placeholder={`成員 ${i + 1} 名稱`}
                  value={m.value}
                  onChange={e => updateMember(i, e.target.value)}
                />
                <button type="button" className="split-modal__member-remove" onClick={() => removeMember(i)} aria-label="移除">
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
            新增成員
          </button>
        </div>

        {error && <p className="split-modal__error">{error}</p>}

        <div className="split-modal__actions">
          <button type="button" className="split-btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? '建立中...' : '建立群組'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
