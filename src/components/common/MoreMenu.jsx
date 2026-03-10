import { useState, useRef, useEffect } from 'react';

export default function MoreMenu({ onOpenSettings, onOpenReminder, onOpenChangelog, isOpen: controlledOpen, onOpenChange }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const btnRef = useRef(null);
  const dropdownRef = useRef(null);

  const isControlled = onOpenChange != null;
  const isOpen = isControlled ? controlledOpen : internalOpen;
  const setIsOpen = isControlled ? (v) => onOpenChange?.(v) : setInternalOpen;

  useEffect(() => {
    const handleClick = (e) => {
      if (btnRef.current?.contains(e.target)) return;
      if (dropdownRef.current?.contains(e.target)) return;
      setIsOpen(false);
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [isControlled]);

  return (
    <div className="more-menu-wrapper more-menu-wrapper--desktop">
      <button
        ref={btnRef}
        type="button"
        className="more-menu-btn more-menu-btn--desktop"
        aria-label="更多選項"
        aria-expanded={isOpen}
        onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="more-menu-icon">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
      </button>
      <div
        ref={dropdownRef}
        className={`more-menu-dropdown${isOpen ? ' is-open' : ''}`}
      >
        <button
          type="button"
          className="more-menu-item"
          onClick={() => { setIsOpen(false); onOpenSettings?.(); }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="more-menu-item-icon">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
          </svg>
          <span>選項管理</span>
        </button>
        <button
          type="button"
          className="more-menu-item"
          onClick={() => { setIsOpen(false); onOpenReminder?.(); }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="more-menu-item-icon">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
          </svg>
          <span>簽到提醒</span>
        </button>
        <button
          type="button"
          className="more-menu-item"
          onClick={() => { setIsOpen(false); onOpenChangelog?.(); }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="more-menu-item-icon">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
          </svg>
          <span>更新紀錄</span>
        </button>
      </div>
    </div>
  );
}
