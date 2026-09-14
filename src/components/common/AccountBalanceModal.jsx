import { useMemo, useRef, useState, useEffect } from 'react';
import Modal from './Modal';
import TransactionListPanel from '@/components/transactions/TransactionListPanel';
import { DisplayAmountTwdScope } from '@/contexts/DisplayAmountContext';
import { useScrollbarOnScroll } from '@/hooks/useScrollbarOnScroll';
import { formatMoney } from '@/lib/utils';
import { calculateAccountBalance, getBalanceSettings } from '@/lib/accountBalance';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * 帳戶餘額彈窗（現金錢包等非信用卡帳戶）。
 *
 * 結構刻意與信用卡彈窗一致（上方餘額、下方本期紀錄），但語意不同：
 * 餘額不會自己回復，補錢就是把金額改掉——所以這裡放了「更新餘額」，
 * 不必為了數一次鈔票跑一趟設定頁。
 *
 * 餘額用 history（從設定時間算到現在，跨月），紀錄用 txs（目前檢視的月／年），
 * 兩者期間本就不同，比照信用卡彈窗的做法。
 */
export default function AccountBalanceModal({
  isOpen, onClose, account, history = [], viewedYear, viewedMonth, otherPeriod,
  txs, onEdit, onDelete, onUpdateBalance, periodName,
}) {
  const { t } = useLanguage();
  const dialogRef = useRef(null);
  const [sortBy, setSortBy] = useState('date');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  useScrollbarOnScroll(dialogRef, isOpen && !!account);

  // 換一個帳戶或重開彈窗時收起編輯狀態，不要把上一次沒存的數字帶過來
  useEffect(() => {
    if (!isOpen) {
      setEditing(false);
      setDraft('');
      setSaveError('');
    }
  }, [isOpen, account]);

  const now = new Date();
  const isViewingOtherMonth = otherPeriod != null
    ? otherPeriod
    : (viewedYear != null && viewedYear !== now.getFullYear()) ||
      (viewedMonth != null && viewedMonth !== now.getMonth() + 1);

  const data = useMemo(() => calculateAccountBalance(account, history), [account, history]);
  const settings = useMemo(() => getBalanceSettings(account), [account]);

  const rows = txs || [];
  const rowsTotal = rows.reduce((sum, tx) => sum + (typeof tx.twdAmount === 'number' ? tx.twdAmount : 0), 0);

  if (!account) return null;
  const accountName = account.name || account.accountName || '';

  const barColor = !data
    ? 'var(--color-progress-track)'
    : data.isOverdrawn || data.usedPercent > 80
      ? 'var(--color-progress-danger)'
      : data.usedPercent > 50
        ? 'var(--color-progress-warn)'
        : 'var(--color-progress-safe)';

  const percentText = data
    ? (data.usedPercent % 1 === 0 ? `${Math.round(data.usedPercent)}%` : `${data.usedPercent.toFixed(1)}%`)
    : '';

  const asOfText = settings
    ? (() => {
        const d = new Date(settings.asOf);
        const pad = (n) => String(n).padStart(2, '0');
        return t('accountBalance.asOf', {
          date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        });
      })()
    : '';

  const startEditing = () => {
    setDraft(data ? String(data.balance) : '');
    setSaveError('');
    setEditing(true);
  };

  const handleSave = async () => {
    const amount = parseFloat(draft);
    if (!Number.isFinite(amount)) {
      setSaveError(t('settings.account.requiredFieldError'));
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      await onUpdateBalance?.(account, amount);
      setEditing(false);
    } catch (err) {
      setSaveError(err?.message || t('common.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="account-balance-modal" titleId="account-balance-modal-title">
      <div className="account-balance-modal__backdrop" onClick={onClose} />
      <div ref={dialogRef} className="account-balance-modal__dialog scrollbar-on-scroll" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="account-balance-modal__close" aria-label={t('common.close')} onClick={onClose}>×</button>
        <h2 id="account-balance-modal-title" className="account-balance-modal__title">{accountName}</h2>
        {isViewingOtherMonth && (
          <p className="account-balance-modal__live-hint">
            {viewedMonth == null
              ? t('accountBalance.liveDataHintYear', { year: viewedYear })
              : t('accountBalance.liveDataHint', { year: viewedYear, month: viewedMonth })}
          </p>
        )}

        <div className="balance-section">
          <div className="balance-header">
            <span className="balance-label">{t('accountBalance.current')}</span>
            <span className={`balance-amount${data?.isOverdrawn ? ' balance-amount--overdrawn' : ''}`}>
              {data ? formatMoney(data.balance) : t('accountBalance.notTracked')}
            </span>
          </div>

          {data && (
            <>
              <div className="balance-progress-row">
                <div className="balance-progress">
                  <div className="balance-bar" style={{ width: `${data.usedPercent}%`, backgroundColor: barColor }} />
                </div>
                <span className="balance-percent" style={{ color: barColor }}>{percentText}</span>
              </div>
              <div className="balance-detail">
                <span>{t('accountBalance.setAmount')}{formatMoney(data.initial)}</span>
                <span>{t('accountBalance.spent')}{formatMoney(data.spent)}</span>
              </div>
              <p className="balance-as-of">{asOfText}</p>
              {data.isOverdrawn && (
                <p className="balance-overdrawn-hint">{t('accountBalance.overdrawn')}</p>
              )}
            </>
          )}

          {editing ? (
            <div className="balance-edit">
              <label className="balance-edit__label" htmlFor="account-balance-input">
                {t('accountBalance.updateHint')}
              </label>
              <div className="balance-edit__row">
                <input
                  id="account-balance-input"
                  className="balance-edit__input"
                  type="number"
                  step="0.01"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  disabled={saving}
                  autoFocus
                />
                <button type="button" className="btn-cancel" onClick={() => setEditing(false)} disabled={saving}>
                  {t('common.cancel')}
                </button>
                <button type="button" className="btn-save" onClick={handleSave} disabled={saving}>
                  {saving ? t('common.saving') : t('common.save')}
                </button>
              </div>
              {saveError && <p className="balance-edit__error">{saveError}</p>}
            </div>
          ) : (
            <button type="button" className="balance-update-btn" onClick={startEditing}>
              {t('accountBalance.updateBtn')}
            </button>
          )}
        </div>

        {txs && (
          <section className="balance-records">
            <div className="balance-records__header">
              <h3 className="balance-records__title">{t('accountBalance.records', { period: periodName })}</h3>
              <span className="balance-records__meta">
                {t('dashboard.categoryDetailCount', { count: rows.length })}
                {rows.length > 0 && ` · ${formatMoney(rowsTotal)}`}
              </span>
            </div>
            <DisplayAmountTwdScope>
              <TransactionListPanel
                txs={rows}
                isOpen={isOpen}
                resetKey={account}
                sortBy={sortBy}
                onSortChange={setSortBy}
                emptyText={t('accountBalance.recordsEmpty', { period: periodName })}
                onEdit={onEdit}
                onDelete={onDelete}
                onCloseParent={onClose}
              />
            </DisplayAmountTwdScope>
          </section>
        )}
      </div>
    </Modal>
  );
}
