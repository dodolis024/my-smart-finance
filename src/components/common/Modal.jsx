import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// 目前開著的彈窗，越後面越上層
const openStack = [];

// 關閉鈕放在卡片外的右上角：× 圖示 22px，離卡片 8px、離螢幕邊至少 16px
const CLOSE_ICON = 22;
const CLOSE_GAP = 8;
const CLOSE_EDGE = 16;

/**
 * 把關閉鈕擺到卡片（overlay 底下帶 data-modal-card 的那個直接子元素）外面：
 * 卡片右側放得下就放右側、跟卡片上緣對齊；放不下（手機、窄視窗）就放卡片上方的右上角，
 * 並在 overlay 加 has-close-above，讓卡片往下讓出位置（CSS 在 modal-close.css）。
 * 位置以 × 圖示本身為準，按鈕比圖示大的那圈（點擊範圍）往外長。
 */
function placeCloseButton(overlay, button) {
  const card = overlay.querySelector(':scope > [data-modal-card]');
  if (!card) return;
  const vw = document.documentElement.clientWidth;
  const pad = (button.offsetWidth - CLOSE_ICON) / 2;
  const side = vw - card.getBoundingClientRect().right >= CLOSE_GAP + pad + CLOSE_ICON + CLOSE_EDGE;
  overlay.classList.toggle('has-close-above', !side);
  const r = card.getBoundingClientRect(); // 切換上方模式後卡片會往下移，重新量
  let iconLeft;
  let iconTop;
  if (side) {
    iconLeft = r.right + CLOSE_GAP + pad;
    iconTop = r.top;
  } else {
    iconLeft = Math.min(r.right, vw - CLOSE_EDGE) - CLOSE_ICON;
    iconTop = r.top - CLOSE_GAP - CLOSE_ICON;
  }
  button.style.left = `${iconLeft - pad}px`;
  button.style.top = `${iconTop - pad}px`;
  button.classList.add('is-placed');
}

export default function Modal({ isOpen, onClose, className = '', titleId, closeLabel, children }) {
  const overlayRef = useRef(null);
  const closeRef = useRef(null);
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

  // 關閉鈕跟著卡片走：卡片大小變、視窗縮放、進場動畫播完都重新定位
  const showClose = Boolean(closeLabel) && (isOpen || closingVisible);
  useLayoutEffect(() => {
    if (!showClose) return;
    const overlay = overlayRef.current;
    const button = closeRef.current;
    const card = overlay?.querySelector(':scope > [data-modal-card]');
    if (!overlay || !button || !card) return;
    let frame = 0;
    const place = () => placeCloseButton(overlay, button);
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    // 卡片有進場位移動畫（交易詳情的 slideUp）時，等動畫播完再出現，免得 × 先停在動畫中途的位置
    const running = card.getAnimations?.() ?? [];
    if (running.length) Promise.all(running.map((a) => a.finished)).then(place, place);
    else place();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    ro?.observe(card);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      ro?.disconnect();
      window.removeEventListener('resize', schedule);
      overlay.classList.remove('has-close-above');
    };
  }, [showClose]);

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
      {closeLabel && (
        <button ref={closeRef} type="button" className="modal-close" aria-label={closeLabel} onClick={onClose}>
          <svg aria-hidden="true" viewBox="0 0 24 24" width={CLOSE_ICON} height={CLOSE_ICON} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
