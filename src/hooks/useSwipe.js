import { useState, useRef, useCallback, useEffect } from 'react';
import { SWIPE, TIMING } from '@/lib/constants';

/** Module-level singleton: holds reset fn of whichever row is currently swiped open */
let currentResetFn = null;

export function useSwipe({ onEdit, onDelete, onClick, isMobile, disableRight = false }) {
  const [translateX, setTranslateX] = useState(0);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const prevTranslate = useRef(0);
  const didMove = useRef(false);
  const skipNextClick = useRef(false);
  const isSwiped = useRef(false);

  const onEditRef = useRef(onEdit);
  const onDeleteRef = useRef(onDelete);
  const onClickRef = useRef(onClick);
  useEffect(() => { onEditRef.current = onEdit; }, [onEdit]);
  useEffect(() => { onDeleteRef.current = onDelete; }, [onDelete]);
  useEffect(() => { onClickRef.current = onClick; }, [onClick]);

  const resetSwipe = useCallback(() => {
    setTranslateX(0);
    prevTranslate.current = 0;
    isSwiped.current = false;
    if (currentResetFn === resetSwipe) currentResetFn = null;
  }, []);

  const handleTouchStart = useCallback(
    (e) => {
      if (!isMobile || e.target.closest('.btn-edit, .btn-delete, .swipe-action-btn')) return;
      if (currentResetFn && currentResetFn !== resetSwipe) currentResetFn();

      const touch = e.touches[0];
      startX.current = touch.clientX;
      startY.current = touch.clientY;
      didMove.current = false;
      isDragging.current = true;
      prevTranslate.current = translateX;
    },
    [isMobile, translateX, resetSwipe]
  );

  const handleTouchMove = useCallback(
    (e) => {
      if (!isDragging.current) return;
      e.preventDefault();
      const touch = e.touches[0];
      const delta = touch.clientX - startX.current;
      const deltaY = touch.clientY - startY.current;
      if (Math.abs(delta) > 4 || Math.abs(deltaY) > 4) didMove.current = true;
      const newTranslate = prevTranslate.current + delta;
      const maxRight = disableRight ? 0 : SWIPE.MAX_RIGHT;
      const limited = Math.max(SWIPE.MAX_LEFT, Math.min(maxRight, newTranslate));
      setTranslateX(limited);
    },
    []
  );

  const handleTouchEnd = useCallback(
    (e) => {
      if (!isDragging.current) return;
      isDragging.current = false;

      setTranslateX((current) => {
        let next = 0;
        if (current < -SWIPE.THRESHOLD) {
          next = -SWIPE.ACTION_WIDTH;
          isSwiped.current = true;
          currentResetFn = resetSwipe;
        } else if (current > SWIPE.THRESHOLD) {
          next = SWIPE.ACTION_WIDTH;
          isSwiped.current = true;
          currentResetFn = resetSwipe;
        } else {
          isSwiped.current = false;
        }
        prevTranslate.current = next;
        return next;
      });

      if (!didMove.current && !isSwiped.current) {
        skipNextClick.current = true;
        e.stopPropagation();
        onClickRef.current?.();
      }
    },
    [resetSwipe]
  );

  const handleRowClick = useCallback((e) => {
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
  }, [resetSwipe]);

  const handleSwipeEdit = useCallback(() => {
    resetSwipe();
    onEditRef.current?.();
  }, [resetSwipe]);

  const handleSwipeDelete = useCallback(() => {
    resetSwipe();
    onDeleteRef.current?.();
  }, [resetSwipe]);

  return {
    translateX,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleRowClick,
    handleSwipeEdit,
    handleSwipeDelete,
    resetSwipe,
  };
}
