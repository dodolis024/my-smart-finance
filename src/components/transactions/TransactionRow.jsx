import { useRef, useEffect } from 'react';
import { formatMoney, formatMoneyInteger, formatDateForDisplay } from '@/lib/utils';
import { LAYOUT } from '@/lib/constants';
import { useWindowSize } from '@/hooks/useWindowSize';
import { useSwipe } from '@/hooks/useSwipe';

export default function TransactionRow({ transaction: tx, onEdit, onDelete, onShowDetail }) {
  const rowRef = useRef(null);
  const { width } = useWindowSize();
  const isMobile = width <= LAYOUT.MOBILE_MAX_WIDTH;
  const displayDate = formatDateForDisplay(tx.date, isMobile);
  const displayAmount = isMobile ? formatMoneyInteger(tx.twdAmount) : formatMoney(tx.twdAmount);

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

  // touchmove 必須用 passive: false 才能呼叫 preventDefault，避免與頁面捲動衝突
  useEffect(() => {
    const el = rowRef.current;
    if (!el || !isMobile) return;
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', handleTouchMove);
  }, [isMobile, handleTouchMove]);

  const transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
  const swipedRight = isMobile && translateX > 20;
  const swipedLeft = isMobile && translateX < -20;
  const rowClass = [
    'transaction-row',
    'transaction-row--semantic',
    tx.subscriptionId && 'transaction-row--subscription',
    swipedRight && 'swiped-right',
    swipedLeft && 'swiped-left',
  ]
    .filter(Boolean)
    .join(' ');

  /* 手機版：4 欄 slider，左滑刪除（金額右側）、右滑編輯（日期左側） */
  if (isMobile) {
    return (
      <tr
        ref={rowRef}
        className={rowClass}
        data-id={String(tx.id || '')}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onClick={handleRowClick}
      >
        <td className="cell-slider-wrap" colSpan={6}>
          <div className="row-slider-container">
            <div
              className="row-slider"
              style={{ transform: `translateX(${translateX}px)`, transition }}
            >
              <div className="slider-cell cell-date">{displayDate}</div>
              <div className="slider-cell cell-category">
                <span className="badge">{tx.category}</span>
              </div>
              <div className="slider-cell cell-item">{tx.itemName}</div>
              <div className="slider-cell cell-amount">{displayAmount}</div>
            </div>
            <div className="swipe-action swipe-action--edit">
              <button
                type="button"
                className="swipe-action-btn"
                aria-label="編輯"
                onClick={(e) => { e.stopPropagation(); handleSwipeEdit(); }}
              >
                <svg className="icon-edit" aria-hidden="true">
                  <use href="#icon-edit" />
                </svg>
              </button>
            </div>
            <div className="swipe-action swipe-action--delete">
              <button
                type="button"
                className="swipe-action-btn"
                aria-label="刪除"
                onClick={(e) => { e.stopPropagation(); handleSwipeDelete(); }}
              >
                <svg className="icon-delete" aria-hidden="true">
                  <use href="#icon-delete" />
                </svg>
              </button>
            </div>
          </div>
        </td>
      </tr>
    );
  }

  /* 桌面版：6 欄 */
  return (
    <tr
      ref={rowRef}
      className={rowClass}
      data-id={String(tx.id || '')}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={handleRowClick}
    >
      <td className="cell-date" headers="col-date">
        <div className="cell-date-inner">{displayDate}</div>
      </td>
      <td className="cell-category" headers="col-category">
        <div className="cell-category-inner">
          <span className="badge">{tx.category}</span>
        </div>
      </td>
      <td className="cell-item" headers="col-item">
        <div className="cell-item-inner">{tx.itemName}</div>
      </td>
      <td className="cell-payment" headers="col-payment">
        <div className="cell-payment-inner">{tx.paymentMethod}</div>
      </td>
      <td className="cell-amount" headers="col-amount">
        <div className="cell-amount-inner">{formatMoney(tx.twdAmount)}</div>
      </td>
      <td className="cell-actions" headers="col-actions">
        <div className="cell-actions-inner">
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
      </td>
    </tr>
  );
}
