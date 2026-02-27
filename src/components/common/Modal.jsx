import { useEffect, useRef } from 'react';

export default function Modal({ isOpen, onClose, className = '', titleId, children }) {
  const overlayRef = useRef(null);
  const openedAtRef = useRef(0);

  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('modal-open');
      openedAtRef.current = Date.now();
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => document.body.classList.remove('modal-open');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    // Ignore clicks within 200ms of modal opening (likely synthetic clicks from touch)
    const timeSinceOpen = Date.now() - openedAtRef.current;
    if (timeSinceOpen < 200) {
      return;
    }
    
    if (e.target === overlayRef.current) {
      onClose();
    }
  };

  const finalClassName = `modal-overlay ${className} ${isOpen ? 'is-open' : ''}`;

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
