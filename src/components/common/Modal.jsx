import { useEffect, useRef, useState } from 'react';

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

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

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
