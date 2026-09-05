import { useState, useRef, useCallback, useEffect } from 'react';
import { SWIPE, TIMING } from '@/lib/constants';

/** Module-level singleton: holds reset fn of whichever row is currently swiped open */
let currentResetFn = null;

const SWIPE_TRANSITION = `transform ${TIMING.SWIPE_TRANSITION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1)`;

export function useSwipe({ onEdit, onDelete, onClick, isMobile, disableRight = false }) {
  const [translateX, setTranslateX] = useState(0);
  // 拖曳中要關掉 transition，否則每次觸控微抖動都會重啟一次補間動畫，整列看起來在閃
  const [isSwiping, setIsSwiping] = useState(false);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const currentTranslate = useRef(0);
  const prevTranslate = useRef(0);
  const didMove = useRef(false);
  const skipNextClick = useRef(false);
  const isSwiped = useRef(false);
  const directionLocked = useRef(null); // 'horizontal' | 'vertical' | null

  const onEditRef = useRef(onEdit);
  const onDeleteRef = useRef(onDelete);
  const onClickRef = useRef(onClick);
  useEffect(() => { onEditRef.current = onEdit; }, [onEdit]);
  useEffect(() => { onDeleteRef.current = onDelete; }, [onDelete]);
  useEffect(() => { onClickRef.current = onClick; }, [onClick]);

  // 位移同時寫進 ref，讓 touchend 能同步讀到當前值（setState 的更新函式是延後執行的）
  const moveTo = useCallback((x) => {
    currentTranslate.current = x;
    setTranslateX(x);
  }, []);

  const resetSwipe = useCallback(() => {
    moveTo(0);
    prevTranslate.current = 0;
    isSwiped.current = false;
    setIsSwiping(false);
    if (currentResetFn === resetSwipe) currentResetFn = null;
  }, [moveTo]);

  const handleTouchStart = useCallback(
    (e) => {
      if (!isMobile || e.target.closest('.btn-edit, .btn-delete, .swipe-action-btn')) return;
      if (currentResetFn && currentResetFn !== resetSwipe) currentResetFn();

      const touch = e.touches[0];
      startX.current = touch.clientX;
      startY.current = touch.clientY;
      didMove.current = false;
      isDragging.current = true;
      directionLocked.current = null;
      prevTranslate.current = currentTranslate.current;
    },
    [isMobile, resetSwipe]
  );

  const handleTouchMove = useCallback(
    (e) => {
      if (!isDragging.current) return;
      const touch = e.touches[0];
      const delta = touch.clientX - startX.current;
      const deltaY = touch.clientY - startY.current;

      // 方向鎖定：首次移動超過 6px 時決定方向
      if (!directionLocked.current && (Math.abs(delta) > 6 || Math.abs(deltaY) > 6)) {
        directionLocked.current = Math.abs(deltaY) > Math.abs(delta) ? 'vertical' : 'horizontal';
        if (directionLocked.current === 'horizontal') setIsSwiping(true);
      }

      // 垂直滑動 → 放棄水平滑動，讓瀏覽器正常捲頁
      if (directionLocked.current === 'vertical') {
        isDragging.current = false;
        return;
      }

      // 方向尚未確定時不更新位移，避免鎖定為垂直後殘留偏移
      if (directionLocked.current !== 'horizontal') return;

      e.preventDefault();
      if (Math.abs(delta) > 4 || Math.abs(deltaY) > 4) didMove.current = true;
      const newTranslate = prevTranslate.current + delta;
      const maxRight = disableRight ? 0 : SWIPE.MAX_RIGHT;
      // 取整數像素：次像素位移會讓文字每幀重新描邊，滑動時看起來毛毛的
      const limited = Math.round(Math.max(SWIPE.MAX_LEFT, Math.min(maxRight, newTranslate)));
      if (limited !== currentTranslate.current) moveTo(limited);
    },
    [disableRight, moveTo]
  );

  // 收尾：依當前位移決定停在開啟或關閉，並把 transition 開回來
  const settle = useCallback(() => {
    const current = currentTranslate.current;
    let next = 0;
    if (current < -SWIPE.THRESHOLD) next = -SWIPE.ACTION_WIDTH;
    else if (current > SWIPE.THRESHOLD) next = SWIPE.ACTION_WIDTH;

    isSwiped.current = next !== 0;
    if (isSwiped.current) currentResetFn = resetSwipe;
    else if (currentResetFn === resetSwipe) currentResetFn = null;

    prevTranslate.current = next;
    moveTo(next);
    setIsSwiping(false);
  }, [moveTo, resetSwipe]);

  const handleTouchEnd = useCallback(
    (e) => {
      if (!isDragging.current) return;
      isDragging.current = false;
      settle();

      if (!didMove.current && !isSwiped.current) {
        skipNextClick.current = true;
        e.stopPropagation();
        onClickRef.current?.();
      }
    },
    [settle]
  );

  // 系統中斷觸控（iOS 長按叫出選單、來電等）不會有 touchend，沒收尾就會卡在半開
  const handleTouchCancel = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;
    settle();
  }, [settle]);

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
    swipeTransition: isSwiping ? 'none' : SWIPE_TRANSITION,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel,
    handleRowClick,
    handleSwipeEdit,
    handleSwipeDelete,
    resetSwipe,
  };
}
