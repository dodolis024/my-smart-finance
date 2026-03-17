import { useState } from 'react';
import Modal from '@/components/common/Modal';

let nextId = 1;

export default function ManageMembersModal({ isOpen, onClose, members, onAddMembers, onRemoveMember }) {
  const [newMembers, setNewMembers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleClose = () => {
    setNewMembers([]);
    setError('');
    onClose();
  };

  const addRow = () => setNewMembers(prev => [...prev, { id: nextId++, value: '' }]);
  const removeRow = (i) => setNewMembers(prev => prev.filter((_, idx) => idx !== i));
  const updateRow = (i, val) => setNewMembers(prev => prev.map((m, idx) => idx === i ? { ...m, value: val } : m));

  const handleSubmit = async () => {
    const names = newMembers.map(m => m.value.trim()).filter(Boolean);
    if (!names.length) { handleClose(); return; }
    setError('');
    setSaving(true);
    try {
      await onAddMembers(names);
      setNewMembers([]);
    } catch (err) {
      setError(err.message || '新增失敗，請稍後再試');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} className="split-modal" titleId="manage-members-title">
      <div className="reminder-modal__backdrop" onClick={handleClose} />
      <div className="split-modal__dialog" onClick={e => e.stopPropagation()} style={{ maxHeight: '90vh', overflowY: 'auto' }}>
        <button type="button" className="reminder-modal__close" aria-label="關閉" onClick={handleClose}>×</button>
        <h2 id="manage-members-title" className="split-modal__title">管理成員</h2>

        {/* 現有成員 */}
        <div className="split-modal__field">
          <label className="split-modal__label">目前成員</label>
          <div className="split-modal__members-list">
            {members?.map(m => (
              <div key={m.id} className="split-modal__member-row split-modal__member-row--existing">
                {m.avatar_url ? (
                  <img className="split-modal__member-avatar" src={m.avatar_url} alt={m.name} />
                ) : (
                  <span className="split-modal__member-avatar split-modal__member-avatar--initial">
                    {m.name?.[0]?.toUpperCase() || '?'}
                  </span>
                )}
                <span className="split-modal__member-name">{m.name}</span>
                {m.user_id && <span className="split-modal__member-linked">已連結</span>}
                {onRemoveMember && !m.user_id && (
                  <button type="button" className="split-modal__member-remove" onClick={() => onRemoveMember(m.id)} aria-label="移除">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 新增成員 */}
        <div className="split-modal__field">
          <label className="split-modal__label">新增成員</label>
          {newMembers.length > 0 && (
            <div className="split-modal__members-list">
              {newMembers.map((m, i) => (
                <div key={m.id} className="split-modal__member-row">
                  <input
                    className="split-modal__input"
                    placeholder={`成員名稱`}
                    value={m.value}
                    onChange={e => updateRow(i, e.target.value)}
                    autoFocus={i === newMembers.length - 1}
                  />
                  <button type="button" className="split-modal__member-remove" onClick={() => removeRow(i)} aria-label="移除">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
          {newMembers.length !== 1 && (
            <button type="button" className="split-modal__add-member-btn" onClick={addRow}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" style={{ width: 15, height: 15 }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              新增成員
            </button>
          )}
        </div>

        {error && <p className="split-modal__error">{error}</p>}

        {newMembers.length > 0 && (
          <div className="split-modal__actions">
            <button type="button" className="split-btn-primary" onClick={handleSubmit} disabled={saving}>
              {saving ? '新增中...' : '確認新增'}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
