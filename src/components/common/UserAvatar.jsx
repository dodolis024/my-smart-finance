import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirm } from '@/contexts/ConfirmContext';

export default function UserAvatar({ variant = 'desktop', isOpen: controlledOpen, onOpenChange }) {
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
