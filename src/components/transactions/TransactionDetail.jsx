import { useRef } from 'react';
import Modal from '@/components/common/Modal';
import { formatMoney, formatCurrencyAmount } from '@/lib/utils';
import { useScrollbarOnScroll } from '@/hooks/useScrollbarOnScroll';
import LinkifiedText from '@/components/common/LinkifiedText';
import { useLanguage } from '@/contexts/LanguageContext';

export default function TransactionDetail({ transaction: tx, isOpen, onClose, onEdit, onDelete }) {
  const { t } = useLanguage();
  const bodyRef = useRef(null);
  useScrollbarOnScroll(bodyRef, isOpen && !!tx);

  if (!tx) return null;

  const originalAmount = tx.originalAmount != null ? tx.originalAmount : (tx.amount != null ? tx.amount : tx.twdAmount);
  const currency = tx.currency || 'TWD';
  const exchangeRate = tx.exchangeRate || tx.exchange_rate || 1.0;
  const twdAmount = tx.twdAmount || tx.twd_amount || 0;
  const overseasFeeRaw = tx.overseasFee ?? tx.overseas_fee;
  const overseasFee = overseasFeeRaw == null ? null : Number(overseasFeeRaw);
  const overseasFeeRate = Number(tx.overseasFeeRate ?? tx.overseas_fee_rate) || null;
  const hasOverseasFee = overseasFee != null;
  // 分帳同步進來的交易預設沒有支付方式，使用者補填後照常顯示
  const showPaymentMethod = Boolean(String(tx.paymentMethod || '').trim());

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
              {currency !== 'TWD' && (
                <span className="transaction-detail-sub">
                  ({t('transaction.exchangeRate')} {Number(exchangeRate).toFixed(4)})
                </span>
              )}
            </div>
          </div>
          {/* 有手續費時，台幣本體可由合計減手續費得出，只列合計；沒有時外幣交易列台幣金額 */}
          {hasOverseasFee ? (
            <div className="transaction-detail-item">
              <div className="transaction-detail-label">{t('transaction.twdTotal')}</div>
              <div className="transaction-detail-value transaction-detail-amount">
                {formatMoney(twdAmount)}
                <span className="transaction-detail-sub">
                  ({overseasFeeRate
                    ? t('transaction.feeIncludedWithRate', { fee: formatMoney(overseasFee), rate: overseasFeeRate })
                    : t('transaction.feeIncluded', { fee: formatMoney(overseasFee) })})
                </span>
              </div>
            </div>
          ) : currency !== 'TWD' && (
            <div className="transaction-detail-item">
              <div className="transaction-detail-label">{t('transaction.twdAmount')}</div>
              <div className="transaction-detail-value transaction-detail-amount">{formatMoney(twdAmount)}</div>
            </div>
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
