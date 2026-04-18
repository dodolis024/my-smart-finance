import { useRef } from 'react';
import Modal from '@/components/common/Modal';
import { formatNumberWithCommas } from '@/lib/utils';
import { useScrollbarOnScroll } from '@/hooks/useScrollbarOnScroll';
import { useLanguage } from '@/contexts/LanguageContext';

export default function SplitShareDetailModal({ isOpen, onClose, snapshot = [], groupName, currency, totalAmount }) {
  const { t } = useLanguage();
  const bodyRef = useRef(null);
  useScrollbarOnScroll(bodyRef, isOpen);

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="transaction-detail-modal" titleId="splitShareDetailTitle">
      <div className="transaction-detail-content">
        <div className="transaction-detail-header">
          <h2 id="splitShareDetailTitle" className="transaction-detail-title">{t('split.shareDetailTitle')}</h2>
          <button type="button" className="transaction-detail-close" aria-label={t('common.close')} onClick={onClose}>
            <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div ref={bodyRef} className="transaction-detail-body scrollbar-on-scroll">
          <div className="split-share-detail__group-name">{groupName}</div>

          {snapshot.length === 0 ? (
            <p className="split-share-detail__empty">{t('split.noShareRecords')}</p>
          ) : (
            <table className="split-share-detail__table">
              <thead>
                <tr>
                  <th className="split-share-detail__th split-share-detail__th--date">{t('transaction.tableDate')}</th>
                  <th className="split-share-detail__th split-share-detail__th--title">{t('split.expenseNameCol')}</th>
                  <th className="split-share-detail__th split-share-detail__th--amount">{t('split.myShareCol')}</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.map((item, i) => (
                  <tr key={item.expense_id || i} className="split-share-detail__row">
                    <td className="split-share-detail__td split-share-detail__td--date">{item.date}</td>
                    <td className="split-share-detail__td split-share-detail__td--title">{item.title}</td>
                    <td className="split-share-detail__td split-share-detail__td--amount">
                      {item.currency} {formatNumberWithCommas(String(Number(item.share)))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="split-share-detail__total-row">
                  <td colSpan={2} className="split-share-detail__total-label">{t('split.totalLabel', { currency })}</td>
                  <td className="split-share-detail__total-amount">
                    {currency} {formatNumberWithCommas(String(Number(totalAmount)))}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </Modal>
  );
}
