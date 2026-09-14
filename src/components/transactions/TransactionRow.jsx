import { useRef, useEffect } from 'react';
import { formatDateForDisplay } from '@/lib/utils';
import { LAYOUT } from '@/lib/constants';
import { useWindowSize } from '@/hooks/useWindowSize';
import { useSwipe } from '@/hooks/useSwipe';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDisplayAmount } from '@/contexts/DisplayAmountContext';

export default function TransactionRow({ transaction: tx, isAlt, showDate = false, categoryColors, onEdit, onDelete, onShowDetail }) {
  const { t } = useLanguage();
  const { describeTxAmount } = useDisplayAmount();
  const rowRef = useRef(null);
  const { width } = useWindowSize();
  const isMobile = width <= LAYOUT.MOBILE_MAX_WIDTH;
  const { text: displayAmount, estimated } = describeTxAmount(tx, { isMobile });
  const amountTitle = estimated ? `${displayAmount}（${t('dashboard.estimatedAmountHint')}）` : displayAmount;
  // 日期平常由分組列統一標示，只有不分組（年檢視）時才逐列印出
  const displayDate = showDate ? formatDateForDisplay(tx.date, isMobile) : '';

  const {
    translateX,
    swipeTransition,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel,
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

  const swipedRight = isMobile && translateX > 20;
  const swipedLeft = isMobile && translateX < -20;
  const rowClass = [
    'transaction-row',
    'transaction-row--semantic',
    isAlt && 'transaction-row--alt',
    tx.subscriptionId && 'transaction-row--subscription',
    tx.pending && 'transaction-row--pending',
    swipedRight && 'swiped-right',
    swipedLeft && 'swiped-left',
  ]
    .filter(Boolean)
    .join(' ');

  // 分類色點:顏色取自圓餅圖那份對應表,同一個分類兩邊同色。
  // 收入分類不在圓餅圖裡、也就沒有顏色,留一個透明的佔位讓欄位仍然對齊。
  const dotColor = categoryColors?.get(tx.category);
  const categoryDot = (
    <span className="cat-dot" style={dotColor ? { background: dotColor } : undefined} aria-hidden="true" />
  );

  // 訂閱自動記帳:手機版空間有限,英文改用短字(中文兩者都是「訂閱」)
  const subscriptionBadge = tx.subscriptionId ? (
    <span className="badge badge--subscription">
      {isMobile ? t('transaction.subscriptionBadgeShort') : t('transaction.subscriptionBadge')}
    </span>
  ) : null;

  // 離線佇列中的交易(尚未同步至伺服器);failed = 補送失敗,等待手動重試
  const isSyncFailed = tx.pending && tx.queueStatus === 'failed';
  const pendingBadge = tx.pending ? (
    <span
      className={`badge ${isSyncFailed ? 'badge--sync-failed' : 'badge--pending'}`}
      title={isSyncFailed ? tx.queueError || undefined : undefined}
    >
      {isSyncFailed ? t('dashboard.pendingSyncFailed') : t('dashboard.pendingSync')}
    </span>
  ) : null;

  /* 手機版：4 欄 slider，左滑刪除（金額右側）、右滑編輯（日期左側） */
  if (isMobile) {
    return (
      <tr
        ref={rowRef}
        className={rowClass}
        data-id={String(tx.id || '')}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        onClick={handleRowClick}
      >
        <td className="cell-slider-wrap" colSpan={showDate ? 6 : 5}>
          <div className="row-slider-container">
            <div
              className="row-slider"
              style={{ transform: `translateX(${translateX}px)`, transition: swipeTransition }}
            >
              {showDate && <div className="slider-cell cell-date">{displayDate}</div>}
              <div className="slider-cell cell-category">
                {categoryDot}<span className="badge">{tx.category}</span>
              </div>
              <div className="slider-cell cell-item">
                <span className="cell-item-name">{tx.itemName}</span>{subscriptionBadge}{pendingBadge}
              </div>
              <div className="slider-cell cell-amount">{displayAmount}</div>
            </div>
            <div className="swipe-action swipe-action--edit">
              <button
                type="button"
                className="swipe-action-btn"
                aria-label={t('common.edit')}
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
                aria-label={t('common.delete')}
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
      onTouchCancel={handleTouchCancel}
      onClick={handleRowClick}
    >
      {showDate && (
        <td className="cell-date">
          <div className="cell-date-inner">{displayDate}</div>
        </td>
      )}
      <td className="cell-category">
        <div className="cell-category-inner">
          {categoryDot}<span className="badge">{tx.category}</span>
        </div>
      </td>
      <td className="cell-item">
        <div className="cell-item-inner">
          <span className="cell-item-name">{tx.itemName}</span>{subscriptionBadge}{pendingBadge}
        </div>
      </td>
      <td className="cell-payment">
        <div className="cell-payment-inner">{tx.paymentMethod}</div>
      </td>
      <td className="cell-amount">
        <div className="cell-amount-inner" title={amountTitle}>{displayAmount}</div>
      </td>
      <td className="cell-actions">
        <div className="cell-actions-inner">
          <div className="row-actions">
            <button
              type="button"
              className="btn-edit"
              aria-label={t('common.edit')}
              onClick={(e) => { e.stopPropagation(); onEdit(tx); }}
            >
              <svg className="icon-edit" aria-hidden="true">
                <use href="#icon-edit" />
              </svg>
            </button>
            <button
              type="button"
              className="btn-delete"
              aria-label={t('common.delete')}
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
