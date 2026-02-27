import SwipeContainer from './SwipeContainer';
import { formatMoney, formatDateForDisplay } from '@/lib/utils';
import { LAYOUT } from '@/lib/constants';

export default function TransactionRow({ transaction: tx, onEdit, onDelete, onShowDetail }) {
  const isMobile = window.innerWidth <= LAYOUT.MOBILE_MAX_WIDTH;
  const displayDate = formatDateForDisplay(tx.date, isMobile);

  return (
    <tr className="transaction-row" data-id={String(tx.id || '')}>
      <td className="transaction-row-cell" colSpan={6}>
        <SwipeContainer
          onEdit={() => onEdit(tx)}
          onDelete={() => onDelete(tx.id)}
          onClick={() => onShowDetail?.(tx)}
        >
            <div className="cell-date">{displayDate}</div>
            <div className="cell-category">
              <span className="badge">{tx.category}</span>
            </div>
            <div className="cell-item">{tx.itemName}</div>
            <div className="cell-payment">{tx.paymentMethod}</div>
            <div className="cell-amount">{formatMoney(tx.twdAmount)}</div>
            <div className="cell-actions row-actions">
              <button
                type="button"
                className="btn-edit"
                aria-label="編輯"
                onClick={(e) => { e.stopPropagation(); onEdit(tx); }}
              >
                <svg className="icon-edit" aria-hidden="true">
                  <use href="#icon-edit" />
                </svg>
              </button>
              <button
                type="button"
                className="btn-delete"
                aria-label="刪除"
                onClick={(e) => { e.stopPropagation(); onDelete(tx.id); }}
              >
                <svg className="icon-delete" aria-hidden="true">
                  <use href="#icon-delete" />
                </svg>
              </button>
            </div>
          </SwipeContainer>
        </td>
      </tr>
  );
}
