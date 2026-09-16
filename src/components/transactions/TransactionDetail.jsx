import { useEffect, useRef, useState } from 'react';
import Modal from '@/components/common/Modal';
import { formatMoney, formatCurrencyAmount } from '@/lib/utils';
import { useScrollbarOnScroll } from '@/hooks/useScrollbarOnScroll';
import { supabase } from '@/lib/supabase';
import LinkifiedText from '@/components/common/LinkifiedText';
import { useLanguage } from '@/contexts/LanguageContext';

export default function TransactionDetail({ transaction: tx, isOpen, onClose, onEdit, onDelete }) {
  const { t } = useLanguage();
  const bodyRef = useRef(null);
  useScrollbarOnScroll(bodyRef, isOpen && !!tx);
  const [resolvedIsSplitSynced, setResolvedIsSplitSynced] = useState(null);

  useEffect(() => {
    if (!isOpen || !tx?.id) return;

    if (typeof tx.isSplitSynced === 'boolean') {
      setResolvedIsSplitSynced(tx.isSplitSynced);
      return;
    }

    let cancelled = false;
    // 查不到就當作不是分帳交易。以前會退而求其次比對分類「分帳」與那句固定備註，
    // 但逐筆同步後分類是群組名稱、備註是費用自己的備註，已經沒有可以猜的線索了。
    setResolvedIsSplitSynced(false);

    supabase
      .from('split_ledger_syncs')
      .select('id')
      .eq('transaction_id', tx.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setResolvedIsSplitSynced(false);
          return;
        }
        setResolvedIsSplitSynced(!!data);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, tx]);

  if (!tx) return null;

  const originalAmount = tx.originalAmount != null ? tx.originalAmount : (tx.amount != null ? tx.amount : tx.twdAmount);
  const currency = tx.currency || 'TWD';
  const exchangeRate = tx.exchangeRate || tx.exchange_rate || 1.0;
  const twdAmount = tx.twdAmount || tx.twd_amount || 0;
  const overseasFeeRaw = tx.overseasFee ?? tx.overseas_fee;
  const overseasFee = overseasFeeRaw == null ? null : Number(overseasFeeRaw);
  const overseasFeeRate = Number(tx.overseasFeeRate ?? tx.overseas_fee_rate) || null;
  const hasOverseasFee = overseasFee != null;
  // twd_amount 已包含手續費；「台幣金額」列顯示本體（= 原幣 × 匯率）
  const baseTwdAmount = hasOverseasFee ? Math.round((twdAmount - overseasFee) * 100) / 100 : twdAmount;
  const isSplitSynced =
    typeof tx.isSplitSynced === 'boolean'
      ? tx.isSplitSynced
      : (resolvedIsSplitSynced ?? false);
  const showPaymentMethod = !isSplitSynced && Boolean(String(tx.paymentMethod || '').trim());

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="transaction-detail-modal" titleId="transactionDetailTitle">
      <div className="transaction-detail-content">
        <div className="transaction-detail-header">
          <h2 id="transactionDetailTitle" className="transaction-detail-title">{t('transaction.detailTitle')}</h2>
          <div className="transaction-detail-header-actions">
            {onEdit && (
              <button type="button" className="btn-edit" aria-label={t('common.edit')} onClick={() => onEdit(tx)}>
                <svg className="icon-edit" aria-hidden="true">
                  <use href="#icon-edit" />
                </svg>
              </button>
            )}
            {onDelete && (
              <button type="button" className="btn-delete" aria-label={t('common.delete')} onClick={() => onDelete(tx)}>
                <svg className="icon-delete" aria-hidden="true">
                  <use href="#icon-delete" />
                </svg>
              </button>
            )}
            <button type="button" className="transaction-detail-close" aria-label={t('common.close')} onClick={onClose}>
              <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
        <div ref={bodyRef} className="transaction-detail-body scrollbar-on-scroll">
          <div className="transaction-detail-item">
            <div className="transaction-detail-label">{t('transaction.date')}</div>
            <div className="transaction-detail-value">{tx.date}</div>
          </div>
          <div className="transaction-detail-item">
            <div className="transaction-detail-label">{t('transaction.category')}</div>
            <div className="transaction-detail-value">
              <span className="badge">{tx.category}</span>
            </div>
          </div>
          <div className="transaction-detail-item">
            <div className="transaction-detail-label">{t('transaction.tableItem')}</div>
            <div className="transaction-detail-value">{tx.itemName}</div>
          </div>
          <div className="transaction-detail-item">
            <div className="transaction-detail-label">{t('transaction.amount')}</div>
            <div className="transaction-detail-value transaction-detail-amount">
              {currency} {formatCurrencyAmount(originalAmount, currency)}
            </div>
          </div>
          {currency !== 'TWD' && (
            <>
              <div className="transaction-detail-item">
                <div className="transaction-detail-label">{t('transaction.exchangeRate')}</div>
                <div className="transaction-detail-value">{Number(exchangeRate).toFixed(4)}</div>
              </div>
              <div className="transaction-detail-item">
                <div className="transaction-detail-label">{t('transaction.twdAmount')}</div>
                <div className="transaction-detail-value transaction-detail-amount">{formatMoney(baseTwdAmount)}</div>
              </div>
            </>
          )}
          {hasOverseasFee && (
            <>
              <div className="transaction-detail-item">
                <div className="transaction-detail-label">{t('transaction.overseasFee')}</div>
                <div className="transaction-detail-value">
                  {formatMoney(overseasFee)}
                  {overseasFeeRate && ` (${overseasFeeRate}%)`}
                </div>
              </div>
              <div className="transaction-detail-item">
                <div className="transaction-detail-label">{t('transaction.twdTotal')}</div>
                <div className="transaction-detail-value transaction-detail-amount">{formatMoney(twdAmount)}</div>
              </div>
            </>
          )}
          {showPaymentMethod && (
            <div className="transaction-detail-item">
              <div className="transaction-detail-label">{t('transaction.paymentMethod')}</div>
              <div className="transaction-detail-value">{tx.paymentMethod}</div>
            </div>
          )}
          <div className="transaction-detail-item transaction-detail-item--note">
            <div className="transaction-detail-label">{t('transaction.note')}</div>
            <div className="transaction-detail-value transaction-detail-note">
              {tx.note ? <LinkifiedText text={tx.note} /> : t('common.notSet')}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
