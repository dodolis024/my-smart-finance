import { useState, useRef, useEffect } from 'react';
import { LAYOUT } from '@/lib/constants';
import { useWindowSize } from '@/hooks/useWindowSize';
import { useSwipe } from '@/hooks/useSwipe';

export default function SplitExpenseItem({ expense, members, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const rowRef = useRef(null);
  const { width } = useWindowSize();
  const isMobile = width <= LAYOUT.MOBILE_MAX_WIDTH;

  const memberMap = Object.fromEntries((members || []).map(m => [m.id, m.name]));
  const paidByName = expense.paid_by ? memberMap[expense.paid_by] || '—' : '—';
  const shares = expense.split_expense_shares || [];

  const {
    translateX,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleRowClick,
    handleSwipeEdit,
    handleSwipeDelete,
  } = useSwipe({
    onEdit: () => onEdit(expense),
    onDelete: () => onDelete(expense.id),
    onClick: () => setExpanded(prev => !prev),
    isMobile,
  });

  useEffect(() => {
    const el = rowRef.current;
    if (!el || !isMobile) return;
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', handleTouchMove);
  }, [isMobile, handleTouchMove]);

  const transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
  const swipedRight = isMobile && translateX > 20;
  const swipedLeft = isMobile && translateX < -20;

  return (
    <div
      ref={rowRef}
      className={`split-expense-item${expanded ? ' is-expanded' : ''}${swipedRight ? ' swiped-right' : ''}${swipedLeft ? ' swiped-left' : ''}`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={handleRowClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && setExpanded(prev => !prev)}
    >
      {/* 手機版滑動動作按鈕 */}
      {isMobile && (
        <>
          <div className="split-expense-item__swipe-action split-expense-item__swipe-action--edit">
            <button type="button" className="split-expense-item__swipe-btn" onClick={e => { e.stopPropagation(); handleSwipeEdit(); }} aria-label="編輯">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
              </svg>
            </button>
          </div>
          <div className="split-expense-item__swipe-action split-expense-item__swipe-action--delete">
            <button type="button" className="split-expense-item__swipe-btn" onClick={e => { e.stopPropagation(); handleSwipeDelete(); }} aria-label="刪除">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
              </svg>
            </button>
          </div>
        </>
      )}

      <div
        className="split-expense-item__content"
        style={isMobile ? { transform: `translateX(${translateX}px)`, transition } : undefined}
      >
        <div className="split-expense-item__header">
          <div className="split-expense-item__info">
            <p className="split-expense-item__title">{expense.title}</p>
            <p className="split-expense-item__meta">
              {paidByName} 付 · {expense.date}
            </p>
          </div>
          <div className="split-expense-item__right">
            <span className="split-expense-item__amount">
              {expense.currency} {Number(expense.amount).toLocaleString()}
            </span>
            {/* 桌面版按鈕 */}
            {!isMobile && (
              <div className="split-expense-item__actions">
                <button
                  type="button"
                  className="split-expense-item__action-btn"
                  onClick={e => { e.stopPropagation(); onEdit(expense); }}
                  aria-label="編輯費用"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="split-expense-item__action-btn split-expense-item__delete"
                  onClick={e => { e.stopPropagation(); onDelete(expense.id); }}
                  aria-label="刪除費用"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>

        {expanded && (
          <div className="split-expense-item__detail">
            {expense.note && (
              <p className="split-expense-item__note">{expense.note}</p>
            )}
            <div className="split-expense-item__shares">
              <p className="split-expense-item__shares-label">分攤明細</p>
              {shares.map(s => (
                <div key={s.id} className="split-expense-item__share-row">
                  <span className="split-expense-item__share-name">
                    {memberMap[s.member_id] || '—'}
                  </span>
                  <span className="split-expense-item__share-amount">
                    {expense.currency} {Number(s.share) % 1 === 0 ? Number(s.share).toLocaleString() : Number(s.share).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
