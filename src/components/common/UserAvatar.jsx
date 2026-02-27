import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export default function UserAvatar({ variant = 'desktop', onOpenSettings, onOpenChangelog, confirm }) {
  const { userInfo, signOut } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  if (!userInfo) return null;

  const isGoogle = userInfo.provider === 'google' && userInfo.avatarUrl;
  const initial = userInfo.email ? userInfo.email[0].toUpperCase() : '?';

  const handleLogout = async () => {
    if (confirm) {
      const confirmed = await confirm('確定要登出嗎？');
      if (!confirmed) return;
    }
    await signOut();
  };

  const isMobile = variant === 'mobile';

  return (
    <div ref={wrapperRef} className={`user-avatar-wrapper--${variant}`}>
      <button
        className="user-avatar-btn"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen((prev) => !prev);
        }}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <span className="user-avatar-inner">
          {isGoogle ? (
            <img src={userInfo.avatarUrl} alt="User Avatar" onError={(e) => { e.target.replaceWith(document.createTextNode(initial)); }} />
          ) : (
            initial
          )}
        </span>
      </button>
      <div
        className={`user-avatar-dropdown user-avatar-dropdown--${variant}${isOpen ? ' is-open' : ''}`}
        aria-hidden={!isOpen}
      >
        <div className="user-avatar-dropdown__email">{userInfo.email || '—'}</div>
        {isMobile && onOpenSettings && (
          <button className="more-menu-item" onClick={() => { setIsOpen(false); onOpenSettings(); }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="more-menu-item-icon">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
            </svg>
            <span>選項管理</span>
          </button>
        )}
        {isMobile && onOpenChangelog && (
          <button className="more-menu-item" onClick={() => { setIsOpen(false); onOpenChangelog(); }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="more-menu-item-icon">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
            </svg>
            <span>Change Log</span>
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
