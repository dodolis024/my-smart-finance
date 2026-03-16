import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirm } from '@/contexts/ConfirmContext';

export default function UserAvatar({ variant = 'desktop', onOpenSettings, onOpenChangelog, isOpen: controlledOpen, onOpenChange }) {
  const { userInfo, signOut } = useAuth();
  const { confirm } = useConfirm();
  const [internalOpen, setInternalOpen] = useState(false);
  const [imgError, setImgError] = useState(false);
  const wrapperRef = useRef(null);

  const isControlled = onOpenChange != null;
  const isOpen = isControlled ? controlledOpen : internalOpen;
  const setIsOpen = useCallback((v) => {
    if (onOpenChange != null) onOpenChange(v);
    else setInternalOpen(v);
  }, [onOpenChange]);

  useEffect(() => {
    const handleClick = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [setIsOpen]);

  if (!userInfo) return null;

  const isGoogle = userInfo.provider === 'google' && userInfo.avatarUrl;
  const initial = userInfo.email ? userInfo.email[0].toUpperCase() : '?';

  const handleLogout = async () => {
    const confirmed = await confirm('確定要登出嗎？');
    if (!confirmed) return;
    await signOut();
  };

  const isMobile = variant === 'mobile';

  return (
    <div ref={wrapperRef} className={`user-avatar-wrapper--${variant}`}>
      <button
        className="user-avatar-btn"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <span className="user-avatar-inner">
          {isGoogle && !imgError ? (
            <img src={userInfo.avatarUrl} alt="User Avatar" onError={() => setImgError(true)} />
          ) : (
            initial
          )}
        </span>
      </button>
      <div
        className={`user-avatar-dropdown user-avatar-dropdown--${variant}${isOpen ? ' is-open' : ''}`}
        {...(!isOpen && { inert: 'true' })}
      >
        <div className="user-avatar-dropdown__email">{userInfo.email || '—'}</div>
        {isMobile && onOpenSettings && (
          <button className="more-menu-item" onClick={() => { setIsOpen(false); onOpenSettings(); }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="more-menu-item-icon">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
            <span>設定</span>
          </button>
        )}
        {isMobile && onOpenChangelog && (
          <button className="more-menu-item" onClick={() => { setIsOpen(false); onOpenChangelog(); }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="more-menu-item-icon">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
            </svg>
            <span>更新紀錄</span>
          </button>
        )}
        <button className="more-menu-item" onClick={handleLogout}>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="more-menu-item-icon">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 9V5.25A2.25 2.25 0 0 1 10.5 3h6a2.25 2.25 0 0 1 2.25 2.25v13.5A2.25 2.25 0 0 1 16.5 21h-6a2.25 2.25 0 0 1-2.25-2.25V15m-3 0-3-3m0 0 3-3m-3 3H15" />
          </svg>
          <span>登出</span>
        </button>
      </div>
    </div>
  );
}
