import { useEffect, useRef, useState } from 'react';
import Modal from '@/components/common/Modal';
import { formatMoney, formatNumberWithCommas } from '@/lib/utils';
import { useScrollbarOnScroll } from '@/hooks/useScrollbarOnScroll';
import { supabase } from '@/lib/supabase';
import SplitShareDetailModal from '@/components/split/SplitShareDetailModal';

export default function TransactionDetail({ transaction: tx, isOpen, onClose }) {
  const bodyRef = useRef(null);
  useScrollbarOnScroll(bodyRef, isOpen && !!tx);
  const [shareDetailOpen, setShareDetailOpen] = useState(false);
  const [shareSnapshot, setShareSnapshot] = useState([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [resolvedIsSplitSynced, setResolvedIsSplitSynced] = useState(null);

  if (!tx) return null;

  const originalAmount = tx.originalAmount != null ? tx.originalAmount : (tx.amount != null ? tx.amount : tx.twdAmount);
  const currency = tx.currency || 'TWD';
  const exchangeRate = tx.exchangeRate || tx.exchange_rate || 1.0;
  const twdAmount = tx.twdAmount || tx.twd_amount || 0;
  const note = tx.note || '無';
  const fallbackSplitGuess = tx.note === '從分帳群組同步' || tx.category === '分帳';
  const isSplitSynced =
    typeof tx.isSplitSynced === 'boolean'
      ? tx.isSplitSynced
      : (resolvedIsSplitSynced ?? fallbackSplitGuess);
  const showPaymentMethod = !isSplitSynced && Boolean(String(tx.paymentMethod || '').trim());

  useEffect(() => {
    if (!isOpen || !tx?.id) return;

    if (typeof tx.isSplitSynced === 'boolean') {
      setResolvedIsSplitSynced(tx.isSplitSynced);
      return;
    }

    let cancelled = false;
    setResolvedIsSplitSynced(fallbackSplitGuess);

    supabase
      .from('split_ledger_syncs')
      .select('id')
      .eq('transaction_id', tx.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setResolvedIsSplitSynced(fallbackSplitGuess);
          return;
        }
        setResolvedIsSplitSynced(!!data);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, tx, fallbackSplitGuess]);

  const handleViewSplitDetail = async () => {
    setShareLoading(true);
    try {
      const { data } = await supabase
        .from('split_ledger_syncs')
        .select('expense_snapshot, synced_amount, synced_currency')
        .eq('transaction_id', tx.id)
        .single();
      if (data) {
        setShareSnapshot(data.expense_snapshot || []);
      }
      setShareDetailOpen(true);
    } finally {
      setShareLoading(false);
    }
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} className="transaction-detail-modal" titleId="transactionDetailTitle">
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
                {currency} {formatNumberWithCommas(String(originalAmount))}
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
            {showPaymentMethod && (
              <div className="transaction-detail-item">
                <div className="transaction-detail-label">支付方式</div>
                <div className="transaction-detail-value">{tx.paymentMethod}</div>
              </div>
            )}
            <div className="transaction-detail-item transaction-detail-item--note">
              <div className="transaction-detail-label">備註</div>
              <div className="transaction-detail-value transaction-detail-note">{note}</div>
            </div>
            {isSplitSynced && (
              <div className="transaction-detail-item">
                <div className="transaction-detail-label">分攤來源</div>
                <div className="transaction-detail-value">
                  <button
                    type="button"
                    className="split-sync-box__btn split-sync-box__btn--secondary"
                    onClick={handleViewSplitDetail}
                    disabled={shareLoading}
                  >
                    {shareLoading ? '載入中...' : '查看分攤明細'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </Modal>

      <SplitShareDetailModal
        isOpen={shareDetailOpen}
        onClose={() => setShareDetailOpen(false)}
        snapshot={shareSnapshot}
        groupName={tx.itemName}
        currency={currency}
        totalAmount={originalAmount}
      />
    </>
  );
}
