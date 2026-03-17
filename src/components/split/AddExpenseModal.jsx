import { useState, useEffect, useMemo } from 'react';
import Modal from '@/components/common/Modal';

export default function AddExpenseModal({ isOpen, onClose, onAdd, onUpdate, editingExpense, members, groupCurrency = 'TWD', currencies = ['TWD', 'USD', 'JPY', 'EUR', 'GBP'] }) {
  const isEditing = !!editingExpense;
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
    if (members?.length && !editingExpense) {
      setParticipants(members.map(m => m.id));
      setPaidBy(members[0]?.id || '');
    }
  }, [memberIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // 編輯模式：預填表單
  useEffect(() => {
    if (!editingExpense) return;
    setTitle(editingExpense.title || '');
    setAmount(String(editingExpense.amount));
    setCurrency(editingExpense.currency || groupCurrency);
    setDate(editingExpense.date || new Date().toISOString().slice(0, 10));
    setNote(editingExpense.note || '');
    setPaidBy(editingExpense.paid_by || '');
    const shares = editingExpense.split_expense_shares || [];
    const participantIds = shares.map(s => s.member_id);
    setParticipants(participantIds);
    // 判斷是否為平均分攤
    const amt = Number(editingExpense.amount);
    const isEqual = participantIds.length > 0 && shares.every(s => {
      const equalShare = Math.floor((amt / participantIds.length) * 100) / 100;
      return Math.abs(Number(s.share) - equalShare) < 0.02 || Math.abs(Number(s.share) - (equalShare + (Math.round((amt - equalShare * participantIds.length) * 100) / 100))) < 0.02;
    });
    if (isEqual) {
      setShareMode('equal');
      setCustomShares({});
    } else {
      setShareMode('custom');
      const cs = {};
      shares.forEach(s => { cs[s.member_id] = String(s.share); });
      setCustomShares(cs);
    }
  }, [editingExpense, groupCurrency]);

  // 自訂模式：計算已手動輸入的金額總和、剩餘金額、未輸入的成員數
  const totalAmt = parseFloat(amount) || 0;
  const manualTotal = participants.reduce((s, id) => {
    const v = customShares[id];
    // 有值且非空字串才算「已手動輸入」
    return (v !== undefined && v !== '') ? s + (parseFloat(v) || 0) : s;
  }, 0);
  const unfilledIds = participants.filter(id => customShares[id] === undefined || customShares[id] === '');
  const remaining = totalAmt - manualTotal;
  const autoShare = unfilledIds.length > 0 ? Math.floor((remaining / unfilledIds.length) * 100) / 100 : 0;

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

  // 自訂模式送出時，將自動分配的金額也納入
  const buildCustomShares = () => {
    const shares = {};
    participants.forEach(id => {
      const v = customShares[id];
      if (v !== undefined && v !== '') {
        shares[id] = parseFloat(v) || 0;
      } else {
        shares[id] = autoShare;
      }
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
      shares = buildCustomShares();
      const total = Object.values(shares).reduce((s, v) => s + v, 0);
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
      const payload = { title: title.trim(), amount: amt, currency, date, note: note.trim(), paidBy, shares: sharesArr };
      if (isEditing) {
        await onUpdate(editingExpense.id, payload);
      } else {
        await onAdd(payload);
      }
      handleClose();
    } catch (err) {
      setError(err.message || (isEditing ? '更新失敗，請稍後再試' : '新增失敗，請稍後再試'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} className="split-modal" titleId="add-expense-title">
      <div className="reminder-modal__backdrop" onClick={handleClose} />
      <div className="split-modal__dialog" onClick={e => e.stopPropagation()}>
        <button type="button" className="reminder-modal__close" aria-label="關閉" onClick={handleClose}>×</button>
        <h2 id="add-expense-title" className="split-modal__title">{isEditing ? '編輯費用' : '新增費用'}</h2>

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
          {shareMode === 'custom' && totalAmt > 0 && participants.length > 0 && (
            <div className={`split-modal__share-status${Math.abs(remaining) < 0.01 && unfilledIds.length === 0 ? ' is-balanced' : remaining < -0.01 ? ' is-over' : ''}`}>
              {Math.abs(remaining) < 0.01 && unfilledIds.length === 0
                ? `已分配 ${totalAmt.toLocaleString()} / ${totalAmt.toLocaleString()} ✓`
                : remaining < -0.01
                  ? `已超出 ${manualTotal.toLocaleString()} / ${totalAmt.toLocaleString()}（超出 ${Math.abs(remaining).toLocaleString()}）`
                  : `已分配 ${manualTotal.toLocaleString()} / ${totalAmt.toLocaleString()}（剩餘 ${remaining.toLocaleString()}）`
              }
            </div>
          )}
          {members?.map(m => {
            const isParticipant = participants.includes(m.id);
            const hasManualValue = customShares[m.id] !== undefined && customShares[m.id] !== '';
            const isAutoFilled = shareMode === 'custom' && isParticipant && !hasManualValue && totalAmt > 0 && unfilledIds.length > 0;
            return (
              <div key={m.id} className="split-modal__participant-row">
                <input
                  type="checkbox"
                  className="split-modal__participant-check"
                  id={`participant-${m.id}`}
                  checked={isParticipant}
                  onChange={() => toggleParticipant(m.id)}
                />
                <label htmlFor={`participant-${m.id}`} className="split-modal__participant-name">{m.name}</label>
                {shareMode === 'custom' && isParticipant && (
                  <div className="split-modal__share-input-wrap">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      className={`split-modal__participant-share${isAutoFilled ? ' is-auto' : ''}`}
                      placeholder={isAutoFilled ? autoShare.toLocaleString() : '0'}
                      value={customShares[m.id] ?? ''}
                      onChange={e => setCustomShares(prev => ({ ...prev, [m.id]: e.target.value }))}
                    />
                    {isAutoFilled && <span className="split-modal__auto-tag">自動</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="split-modal__field">
          <label className="split-modal__label" htmlFor="expense-note">備註（選填）</label>
          <input id="expense-note" className="split-modal__input" placeholder="備註" value={note} onChange={e => setNote(e.target.value)} />
        </div>

        {error && <p className="split-modal__error">{error}</p>}

        <div className="split-modal__actions">
          <button type="button" className="split-btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? (isEditing ? '更新中...' : '新增中...') : (isEditing ? '儲存變更' : '新增費用')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
