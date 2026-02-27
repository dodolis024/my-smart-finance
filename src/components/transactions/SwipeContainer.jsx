import { useRef, useEffect } from 'react';
import { SWIPE, TIMING } from '@/lib/constants';

// Module-level singleton: holds reset fn of whichever row is currently swiped open
let currentResetFn = null;

export default function SwipeContainer({ onEdit, onDelete, onClick, children }) {
  const containerRef = useRef(null);
  const contentRef = useRef(null);
  const swipeState = useRef({ currentTranslate: 0, prevTranslate: 0 });
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const didMove = useRef(false);
  const skipNextClick = useRef(false);
  const isSwiped = useRef(false);

  // Keep latest callbacks in refs so the stable useEffect closure can read them
  const onEditRef = useRef(onEdit);
  const onDeleteRef = useRef(onDelete);
  const onClickRef = useRef(onClick);
  useEffect(() => { onEditRef.current = onEdit; }, [onEdit]);
  useEffect(() => { onDeleteRef.current = onDelete; }, [onDelete]);
  useEffect(() => { onClickRef.current = onClick; }, [onClick]);

  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    function setTranslateX(x) {
      content.style.transform = `translateX(${x}px)`;
      swipeState.current.currentTranslate = x;
    }

    function resetSwipe() {
      swipeState.current.currentTranslate = 0;
      swipeState.current.prevTranslate = 0;
      content.style.transition = `transform ${TIMING.SWIPE_TRANSITION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1)`;
      setTranslateX(0);
      container.classList.remove('swiped-left', 'swiped-right');
      isSwiped.current = false;
      if (currentResetFn === resetSwipe) currentResetFn = null;
    }

    // Expose reset so swipe action buttons can call it
    container._resetSwipe = resetSwipe;

    function handleTouchStart(e) {
      if (e.target.closest('.btn-edit, .btn-delete, .swipe-action-btn')) return;

      if (currentResetFn && currentResetFn !== resetSwipe) {
        currentResetFn();
      }

      const touch = e.touches[0];
      startX.current = touch.clientX;
      startY.current = touch.clientY;
      didMove.current = false;
      isDragging.current = true;
      content.style.transition = 'none';
      swipeState.current.prevTranslate = swipeState.current.currentTranslate;
    }

    function handleTouchMove(e) {
      if (!isDragging.current) return;
      e.preventDefault();

      const touch = e.touches[0];
      const delta = touch.clientX - startX.current;
      const deltaY = touch.clientY - startY.current;
      if (Math.abs(delta) > 4 || Math.abs(deltaY) > 4) {
        didMove.current = true;
      }
      const newTranslate = swipeState.current.prevTranslate + delta;
      const limited = Math.max(SWIPE.MAX_LEFT, Math.min(SWIPE.MAX_RIGHT, newTranslate));
      setTranslateX(limited);
    }

    function handleTouchEnd(e) {
      if (!isDragging.current) return;
      isDragging.current = false;

      content.style.transition = `transform ${TIMING.SWIPE_TRANSITION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1)`;

      const current = swipeState.current.currentTranslate;

      if (current < -SWIPE.THRESHOLD) {
        swipeState.current.currentTranslate = -SWIPE.ACTION_WIDTH;
        swipeState.current.prevTranslate = -SWIPE.ACTION_WIDTH;
        setTranslateX(-SWIPE.ACTION_WIDTH);
        container.classList.add('swiped-left');
        container.classList.remove('swiped-right');
        isSwiped.current = true;
        currentResetFn = resetSwipe;
      } else if (current > SWIPE.THRESHOLD) {
        swipeState.current.currentTranslate = SWIPE.ACTION_WIDTH;
        swipeState.current.prevTranslate = SWIPE.ACTION_WIDTH;
        setTranslateX(SWIPE.ACTION_WIDTH);
        container.classList.add('swiped-right');
        container.classList.remove('swiped-left');
        isSwiped.current = true;
        currentResetFn = resetSwipe;
      } else {
        resetSwipe();
      }

      // On mobile, click may be suppressed after touch interactions.
      // Fire detail open directly for a tap gesture.
      if (!didMove.current && !isSwiped.current) {
        skipNextClick.current = true;
        e.stopPropagation();
        onClickRef.current?.();
      }
    }

    function handleContentClick(e) {
      if (e.target.closest('.btn-edit, .btn-delete')) return;
      if (skipNextClick.current) {
        skipNextClick.current = false;
        return;
      }
      if (isSwiped.current) {
        e.preventDefault();
        resetSwipe();
        return;
      }
      onClickRef.current?.();
    }

    content.addEventListener('touchstart', handleTouchStart, { passive: false });
    content.addEventListener('touchmove', handleTouchMove, { passive: false });
    content.addEventListener('touchend', handleTouchEnd, { passive: true });
    content.addEventListener('click', handleContentClick);

    return () => {
      content.removeEventListener('touchstart', handleTouchStart);
      content.removeEventListener('touchmove', handleTouchMove);
      content.removeEventListener('touchend', handleTouchEnd);
      content.removeEventListener('click', handleContentClick);
      if (currentResetFn === resetSwipe) currentResetFn = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSwipeEdit() {
    containerRef.current?._resetSwipe?.();
    onEditRef.current?.();
  }

  function handleSwipeDelete() {
    containerRef.current?._resetSwipe?.();
    onDeleteRef.current?.();
  }

  return (
    <div ref={containerRef} className="swipe-container">
      <div className="swipe-action swipe-action--edit">
        <button
          type="button"
          className="swipe-action-btn swipe-action-btn--edit"
          aria-label="編輯"
          onClick={handleSwipeEdit}
        >
          <svg className="icon-edit" aria-hidden="true">
            <use href="#icon-edit" />
          </svg>
        </button>
      </div>

      <div ref={contentRef} className="swipe-content">
        {children}
      </div>

      <div className="swipe-action swipe-action--delete">
        <button
          type="button"
          className="swipe-action-btn swipe-action-btn--delete"
          aria-label="刪除"
          onClick={handleSwipeDelete}
        >
          <svg className="icon-delete" aria-hidden="true">
            <use href="#icon-delete" />
          </svg>
        </button>
      </div>
    </div>
  );
}
