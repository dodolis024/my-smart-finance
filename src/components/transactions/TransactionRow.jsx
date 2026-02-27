import { formatMoney, formatDateForDisplay } from '@/lib/utils';
import { LAYOUT } from '@/lib/constants';
import { useWindowSize } from '@/hooks/useWindowSize';
import { useSwipe } from '@/hooks/useSwipe';

export default function TransactionRow({ transaction: tx, onEdit, onDelete, onShowDetail }) {
  const { width } = useWindowSize();
  const isMobile = width <= LAYOUT.MOBILE_MAX_WIDTH;
  const displayDate = formatDateForDisplay(tx.date, isMobile);

  const {
    translateX,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleRowClick,
    handleSwipeEdit,
    handleSwipeDelete,
  } = useSwipe({
    onEdit: () => onEdit(tx),
    onDelete: () => onDelete(tx.id),
    onClick: () => onShowDetail?.(tx),
    isMobile,
  });

  const cellTransform = isMobile ? { transform: `translateX(${translateX}px)` } : undefined;
  const transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';

  return (
    <tr
      className="transaction-row transaction-row--semantic"
      data-id={String(tx.id || '')}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClick={handleRowClick}
    >
      <td className="cell-date" headers="col-date">
        <div className="cell-date-inner" style={cellTransform ? { ...cellTransform, transition } : undefined}>
          {displayDate}
        </div>
        {isMobile && (
          <div className="swipe-action swipe-action--edit">
            <button
              type="button"
              className="swipe-action-btn swipe-action-btn--edit"
              aria-label="編輯"
              onClick={(e) => { e.stopPropagation(); handleSwipeEdit(); }}
            >
              <svg className="icon-edit" aria-hidden="true">
                <use href="#icon-edit" />
              </svg>
            </button>
          </div>
        )}
      </td>
      <td className="cell-category" headers="col-category">
        <div className="cell-category-inner" style={cellTransform ? { ...cellTransform, transition } : undefined}>
          <span className="badge">{tx.category}</span>
        </div>
      </td>
      <td className="cell-item" headers="col-item">
        <div className="cell-item-inner" style={cellTransform ? { ...cellTransform, transition } : undefined}>
          {tx.itemName}
        </div>
      </td>
      <td className="cell-payment" headers="col-payment">
        <div className="cell-payment-inner" style={cellTransform ? { ...cellTransform, transition } : undefined}>
          {tx.paymentMethod}
        </div>
      </td>
      <td className="cell-amount" headers="col-amount">
        <div className="cell-amount-inner" style={cellTransform ? { ...cellTransform, transition } : undefined}>
          {formatMoney(tx.twdAmount)}
        </div>
      </td>
      <td className="cell-actions" headers="col-actions">
        <div className="cell-actions-inner" style={cellTransform ? { ...cellTransform, transition } : undefined}>
          <div className="row-actions">
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
        </div>
        {isMobile && (
          <div className="swipe-action swipe-action--delete">
            <button
              type="button"
              className="swipe-action-btn swipe-action-btn--delete"
              aria-label="刪除"
              onClick={(e) => { e.stopPropagation(); handleSwipeDelete(); }}
            >
              <svg className="icon-delete" aria-hidden="true">
                <use href="#icon-delete" />
              </svg>
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
