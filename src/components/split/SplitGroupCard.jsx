import { useRef, useEffect } from 'react';
import { LAYOUT } from '@/lib/constants';
import { useWindowSize } from '@/hooks/useWindowSize';
import { useSwipe } from '@/hooks/useSwipe';

function MemberAvatar({ member }) {
  const initial = member.name?.[0]?.toUpperCase() || '?';

  if (member.avatar_url) {
    return (
      <span className="split-member-avatar" title={member.name}>
        <img src={member.avatar_url} alt={member.name} />
      </span>
    );
  }
  return (
    <span className="split-member-avatar" title={member.name}>
      {initial}
    </span>
  );
}

export default function SplitGroupCard({ group, onClick, onDelete }) {
  const cardRef = useRef(null);
  const { width } = useWindowSize();
  const isMobile = width <= LAYOUT.MOBILE_MAX_WIDTH;
  const memberCount = group.split_members?.length || 0;

  const {
    translateX,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleRowClick,
    handleSwipeDelete,
  } = useSwipe({
    onDelete: () => onDelete?.(group.id),
    onClick: () => onClick(),
    isMobile,
    disableRight: true,
  });

  useEffect(() => {
    const el = cardRef.current;
    if (!el || !isMobile) return;
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', handleTouchMove);
  }, [isMobile, handleTouchMove]);

  const transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
  const swipedLeft = isMobile && translateX < -20;

  return (
    <div
      ref={cardRef}
      className={`split-group-card${swipedLeft ? ' swiped-left' : ''}`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={handleRowClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick()}
    >
      {/* 手機版滑動刪除 */}
      {isMobile && (
        <div className="split-group-card__swipe-action">
          <button
            type="button"
            className="split-group-card__swipe-btn"
            onClick={e => { e.stopPropagation(); handleSwipeDelete(); }}
            aria-label="刪除群組"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
            </svg>
          </button>
        </div>
      )}

      <div
        className="split-group-card__content"
        style={isMobile ? { transform: `translateX(${translateX}px)`, transition } : undefined}
      >
        <div className="split-group-card__top">
          <p className="split-group-card__name">{group.name}</p>
          {/* 桌面版刪除按鈕 */}
          {!isMobile && onDelete && (
            <button
              type="button"
              className="split-group-card__delete"
              onClick={e => { e.stopPropagation(); onDelete(group.id); }}
              aria-label="刪除群組"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
              </svg>
            </button>
          )}
        </div>
        <div className="split-group-card__meta">
          <span>{memberCount} 人</span>
          <span>{group.currency || 'TWD'}</span>
        </div>
        {group.split_members?.length > 0 && (
          <div className="split-group-card__members">
            {group.split_members.slice(0, 6).map(m => (
              <MemberAvatar key={m.id} member={m} />
            ))}
            {group.split_members.length > 6 && (
              <span className="split-member-avatar" style={{ fontSize: '0.65rem' }}>
                +{group.split_members.length - 6}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
