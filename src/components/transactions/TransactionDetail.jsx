import { useRef } from 'react';
import Modal from '@/components/common/Modal';
import { formatMoney, formatNumberWithCommas } from '@/lib/utils';
import { useScrollbarOnScroll } from '@/hooks/useScrollbarOnScroll';

export default function TransactionDetail({ transaction: tx, isOpen, onClose }) {
  const bodyRef = useRef(null);
  useScrollbarOnScroll(bodyRef, isOpen && !!tx);

  if (!tx) return null;

  const originalAmount = tx.originalAmount != null ? tx.originalAmount : (tx.amount != null ? tx.amount : tx.twdAmount);
  const currency = tx.currency || 'TWD';
  const exchangeRate = tx.exchangeRate || tx.exchange_rate || 1.0;
  const twdAmount = tx.twdAmount || tx.twd_amount || 0;
  const note = tx.note || '無';

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="transaction-detail-modal">
      <div className="transaction-detail-content">
        <div className="transaction-detail-header">
          <h2 id="transactionDetailTitle" className="transaction-detail-title">交易詳情</h2>
          <button type="button" className="transaction-detail-close" aria-label="關閉" onClick={onClose}>
            <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div ref={bodyRef} className="transaction-detail-body scrollbar-on-scroll">
          <div className="transaction-detail-item">
            <div className="transaction-detail-label">日期</div>
            <div className="transaction-detail-value">{tx.date}</div>
          </div>
          <div className="transaction-detail-item">
            <div className="transaction-detail-label">分類</div>
            <div className="transaction-detail-value">
              <span className="badge">{tx.category}</span>
            </div>
          </div>
          <div className="transaction-detail-item">
            <div className="transaction-detail-label">項目</div>
            <div className="transaction-detail-value">{tx.itemName}</div>
          </div>
          <div className="transaction-detail-item">
            <div className="transaction-detail-label">金額</div>
            <div className="transaction-detail-value transaction-detail-amount">
              {formatNumberWithCommas(String(originalAmount))} {currency}
            </div>
          </div>
          {currency !== 'TWD' && (
            <>
              <div className="transaction-detail-item">
                <div className="transaction-detail-label">匯率</div>
                <div className="transaction-detail-value">{Number(exchangeRate).toFixed(4)}</div>
              </div>
              <div className="transaction-detail-item">
                <div className="transaction-detail-label">台幣金額</div>
                <div className="transaction-detail-value transaction-detail-amount">{formatMoney(twdAmount)}</div>
              </div>
            </>
          )}
          <div className="transaction-detail-item">
            <div className="transaction-detail-label">支付方式</div>
            <div className="transaction-detail-value">{tx.paymentMethod}</div>
          </div>
          <div className="transaction-detail-item transaction-detail-item--note">
            <div className="transaction-detail-label">備註</div>
            <div className="transaction-detail-value transaction-detail-note">{note}</div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
