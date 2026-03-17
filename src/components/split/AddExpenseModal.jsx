import { useState, useEffect, useMemo } from 'react';
import Modal from '@/components/common/Modal';

export default function AddExpenseModal({ isOpen, onClose, onAdd, members, groupCurrency = 'TWD', currencies = ['TWD', 'USD', 'JPY', 'EUR', 'GBP'] }) {
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(groupCurrency);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [paidBy, setPaidBy] = useState('');
  const [shareMode, setShareMode] = useState('equal'); // 'equal' | 'custom'
  const [participants, setParticipants] = useState([]);
  const [customShares, setCustomShares] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // 穩定化 members 引用，避免父層 re-render 時不必要地重設表單
  const memberIds = useMemo(() => (members || []).map(m => m.id).join(','), [members]);
  useEffect(() => {
    if (members?.length) {
      setParticipants(members.map(m => m.id));
      setPaidBy(members[0]?.id || '');
    }
  }, [memberIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = () => {
    setTitle(''); setAmount(''); setNote(''); setError('');
    setCurrency(groupCurrency);
    setShareMode('equal');
    setCustomShares({});
    if (members?.length) {
      setParticipants(members.map(m => m.id));
      setPaidBy(members[0]?.id || '');
      setDate(new Date().toISOString().slice(0, 10));
    }
    onClose();
  };

  const toggleParticipant = (id) => {
    setParticipants(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
    // 取消勾選時清除該成員的自訂金額，避免驗證加總錯誤
    if (participants.includes(id)) {
      setCustomShares(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const calcEqualShares = () => {
    const amt = parseFloat(amount) || 0;
    const n = participants.length;
    if (!n) return {};
    const base = Math.floor((amt / n) * 100) / 100;
    const remainder = Math.round((amt - base * n) * 100) / 100;
    const shares = {};
    participants.forEach((id, i) => {
      shares[id] = i === 0 ? base + remainder : base;
    });
    return shares;
  };

  const handleSubmit = async () => {
    if (!title.trim()) { setError('請填寫費用名稱'); return; }
    const amt = parseFloat(amount);
    if (!amount || isNaN(amt) || amt <= 0) { setError('請輸入有效金額'); return; }
    if (!paidBy) { setError('請選擇付款人'); return; }
    if (!participants.length) { setError('請選擇至少一位參與成員'); return; }

    let shares;
    if (shareMode === 'equal') {
      shares = calcEqualShares();
    } else {
      shares = customShares;
      const total = participants.reduce((s, id) => s + (parseFloat(shares[id]) || 0), 0);
      if (Math.abs(total - amt) > 0.02) {
        setError(`自訂金額總和（${total.toFixed(2)}）必須等於費用金額（${amt.toFixed(2)}）`);
        return;
      }
    }

    const sharesArr = Object.entries(shares)
      .filter(([id]) => participants.includes(id))
      .map(([member_id, share]) => ({ member_id, share: parseFloat(share) }));

    setError('');
    setSaving(true);
    try {
      await onAdd({ title: title.trim(), amount: amt, currency, date, note: note.trim(), paidBy, shares: sharesArr });
      handleClose();
    } catch (err) {
      setError(err.message || '新增失敗，請稍後再試');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} className="split-modal" titleId="add-expense-title">
      <div className="reminder-modal__backdrop" onClick={handleClose} />
      <div className="split-modal__dialog" onClick={e => e.stopPropagation()} style={{ maxHeight: '90vh', overflowY: 'auto' }}>
        <button type="button" className="reminder-modal__close" aria-label="關閉" onClick={handleClose}>×</button>
        <h2 id="add-expense-title" className="split-modal__title">新增費用</h2>

        <div className="split-modal__field">
          <label className="split-modal__label" htmlFor="expense-title">費用名稱</label>
          <input id="expense-title" className="split-modal__input" placeholder="例：民宿" value={title} onChange={e => setTitle(e.target.value)} />
        </div>

        <div className="split-modal__field">
          <label className="split-modal__label" htmlFor="expense-amount">金額</label>
          <div className="split-modal__amount-row">
            <input id="expense-amount" className="split-modal__input" type="number" min="0" step="1" placeholder="0" value={amount} onChange={e => setAmount(e.target.value)} />
            <select className="split-modal__select split-modal__currency-select" value={currency} onChange={e => setCurrency(e.target.value)}>
              {currencies.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div className="split-modal__field">
          <label className="split-modal__label" htmlFor="expense-date">日期</label>
          <input id="expense-date" className="split-modal__input" type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>

        <div className="split-modal__field">
          <label className="split-modal__label" htmlFor="expense-paidby">誰付款</label>
          <select id="expense-paidby" className="split-modal__select" value={paidBy} onChange={e => setPaidBy(e.target.value)}>
            {members?.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>

        <div className="split-modal__field">
          <label className="split-modal__label">分攤方式</label>
          <div className="split-modal__share-modes">
            <button type="button" className={`split-modal__share-mode-btn${shareMode === 'equal' ? ' is-active' : ''}`} onClick={() => setShareMode('equal')}>平均分攤</button>
            <button type="button" className={`split-modal__share-mode-btn${shareMode === 'custom' ? ' is-active' : ''}`} onClick={() => setShareMode('custom')}>自訂金額</button>
          </div>
        </div>

        <div className="split-modal__field">
          <label className="split-modal__label">參與成員</label>
          {members?.map(m => (
            <div key={m.id} className="split-modal__participant-row">
              <input
                type="checkbox"
                className="split-modal__participant-check"
                id={`participant-${m.id}`}
                checked={participants.includes(m.id)}
                onChange={() => toggleParticipant(m.id)}
              />
              <label htmlFor={`participant-${m.id}`} className="split-modal__participant-name">{m.name}</label>
              {shareMode === 'custom' && participants.includes(m.id) && (
                <input
                  type="number"
                  min="0"
                  step="1"
                  className="split-modal__participant-share"
                  placeholder="0"
                  value={customShares[m.id] ?? ''}
                  onChange={e => setCustomShares(prev => ({ ...prev, [m.id]: e.target.value }))}
                />
              )}
            </div>
          ))}
        </div>

        <div className="split-modal__field">
          <label className="split-modal__label" htmlFor="expense-note">備註（選填）</label>
          <input id="expense-note" className="split-modal__input" placeholder="備註" value={note} onChange={e => setNote(e.target.value)} />
        </div>

        {error && <p className="split-modal__error">{error}</p>}

        <div className="split-modal__actions">
          <button type="button" className="split-btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? '新增中...' : '新增費用'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
