import { useEffect, useRef, useState } from 'react';

// 目前開著的彈窗，越後面越上層
const openStack = [];

export default function Modal({ isOpen, onClose, className = '', titleId, children }) {
  const overlayRef = useRef(null);
  const openedAtRef = useRef(0);
  // Only used to keep DOM alive briefly after close for fade-out
  const [closingVisible, setClosingVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('modal-open');
      openedAtRef.current = Date.now();
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => document.body.classList.remove('modal-open');
  }, [isOpen]);

  // On close: keep in DOM for 60ms fade-out, then remove
  useEffect(() => {
    if (!isOpen) return;
    // When isOpen goes from true → false, this cleanup runs
    return () => {
      setClosingVisible(true);
      const timer = setTimeout(() => setClosingVisible(false), 60);
      // Can't return cleanup from cleanup, store timer ref
      closingTimerRef.current = timer;
    };
  }, [isOpen]);

  const closingTimerRef = useRef(null);
  useEffect(() => {
    return () => { if (closingTimerRef.current) clearTimeout(closingTimerRef.current); };
  }, []);

  // onClose 每次重繪都可能是新的函式；放 ref，開著的期間不用重新排進堆疊
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const token = {};
    openStack.push(token);
    const handleKey = (e) => {
      // 疊了好幾層（例如明細上再開交易詳情），Esc 只關最上面那層
      if (e.key === 'Escape' && openStack[openStack.length - 1] === token) onCloseRef.current();
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      openStack.splice(openStack.indexOf(token), 1);
    };
  }, [isOpen]);

  // Render if open (immediate, no extra render cycle) OR if in closing fade-out
  if (!isOpen && !closingVisible) return null;

  const handleBackdropClick = (e) => {
    const timeSinceOpen = Date.now() - openedAtRef.current;
    if (timeSinceOpen < 200) return;
    if (e.target === overlayRef.current) onClose();
  };

  const finalClassName = `modal-overlay ${className} ${isOpen ? 'is-open' : 'is-closing'}`;

  return (
    <div
      ref={overlayRef}
      className={finalClassName}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={handleBackdropClick}
    >
      {children}
    </div>
  );
}
