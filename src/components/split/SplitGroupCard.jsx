import { useRef, useEffect } from 'react';
import { LAYOUT } from '@/lib/constants';
import { useWindowSize } from '@/hooks/useWindowSize';
import { useSwipe } from '@/hooks/useSwipe';
import { useLanguage } from '@/contexts/LanguageContext';

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

// 置頂圖示。刻意不用現成圖示庫：本檔其餘圖示皆為 Heroicons v2 outline，
// 混入其他套件（如 Lucide）的網格與端點處理會明顯出戲。此處照 Heroicons 的
// 規則自繪——stroke 1.5、轉角半徑取 0.375 的倍數（0.75），以 arc 收角。
//
// 傾斜 45°（同 📌）而非直立：直立的細長側面難一眼讀成圖釘，容易看成釘子，
// 且實測只佔 8.5x18，與垃圾桶的 16.5x19.5 並排時明顯瘦小。傾斜後外框
// 18.5x18.5，視覺重量與鄰居相當。
//
// 釘頭 9.9、針 11.4（針/頭 = 1.15）。這個比例是掃過一輪挑的：外框固定時
// 兩者互相牽制——針縮短會讓整體變短、尺度放大，釘頭就脹成大菱形；針拉長
// 則釘頭縮成小方塊、整支像棒棒糖。1.15 是兩邊都不犯的位置。
//
// 旋轉已烘進座標，不用 SVG transform：transform 的 scale 會連 stroke-width
// 一起縮放，1.5 就不再是 1.5，與其他圖示對不上。純旋轉是剛體變換，
// 圓角半徑 0.75 原封不動。
//
// 釘身與頂桿維持線條：填滿時細線會消失，只有釘頭填色才分得出置頂與否。
const PIN_HEAD = 'M14.81 3.29 L10.63 7.46 A0.75 0.75 0 0 1 10.34 7.64 L7.63 8.54 A0.75 0.75 0 0 0 7.34 9.78 L14.22 16.66 A0.75 0.75 0 0 0 15.46 16.37 L16.36 13.66 A0.75 0.75 0 0 1 16.54 13.37 L20.71 9.19';

function PinIcon({ filled }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={filled ? `${PIN_HEAD}Z` : PIN_HEAD} fill={filled ? 'currentColor' : 'none'} />
      <path d="M14.27 2.75L21.25 9.73" />
      <path d="M10.78 13.22L2.75 21.25" />
    </svg>
  );
}

export default function SplitGroupCard({ group, onClick, onDelete, onTogglePin, archived = false }) {
  const { t } = useLanguage();
  const cardRef = useRef(null);
  const { width } = useWindowSize();
  const isMobile = width <= LAYOUT.MOBILE_MAX_WIDTH;
  const memberCount = group.split_members?.length || 0;
  const pinned = Boolean(group.pinned_at);

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
      className={`split-group-card${swipedLeft ? ' swiped-left' : ''}${pinned && !archived ? ' is-pinned' : ''}${archived ? ' split-group-card--archived' : ''}`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={handleRowClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick()}
    >
      {/* 手機版滑動刪除（非群主拿不到 onDelete，連滑動選項都不出現）*/}
      {isMobile && onDelete && (
        <div className="split-group-card__swipe-action">
          <button
            type="button"
            className="split-group-card__swipe-btn"
            onClick={e => { e.stopPropagation(); handleSwipeDelete(); }}
            aria-label={t('split.deleteGroup')}
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
          <p className="split-group-card__name">
            {group.name}
            {archived && <span className="split-group-card__archived-badge">{t('split.archivedBadge')}</span>}
          </p>
          <div className="split-group-card__actions">
            {/* 置頂鈕手機版也要有：左滑已經給刪除用了 */}
            {onTogglePin && !archived && (
              <button
                type="button"
                className={`split-group-card__pin${pinned ? ' is-pinned' : ''}`}
                onClick={e => { e.stopPropagation(); onTogglePin(group.id); }}
                onKeyDown={e => e.stopPropagation()}
                aria-pressed={pinned}
                aria-label={t(pinned ? 'split.unpinGroup' : 'split.pinGroup')}
                title={t(pinned ? 'split.unpinGroup' : 'split.pinGroup')}
              >
                <PinIcon filled={pinned} />
              </button>
            )}
            {/* 桌面版刪除按鈕 */}
            {!isMobile && onDelete && (
              <button
                type="button"
                className="split-group-card__delete"
                onClick={e => { e.stopPropagation(); onDelete(group.id); }}
                aria-label={t('split.deleteGroup')}
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                </svg>
              </button>
            )}
          </div>
        </div>
        <div className="split-group-card__meta">
          <span>{t('split.memberCount', { count: memberCount })}</span>
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
