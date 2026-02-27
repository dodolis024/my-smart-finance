import { useEffect, useRef } from 'react';

/**
 * Adds "is-scrolling" class to the element when user scrolls (wheel, touch, scrollbar drag).
 * Removes it after a short delay of no scroll activity.
 * Use with .scrollbar-on-scroll CSS to show scrollbar only when scrolling.
 */
export function useScrollbarOnScroll(elementRef, isActive = true) {
  const timeoutRef = useRef(null);
  const scrollTimeoutMs = 1200;

  useEffect(() => {
    if (!isActive || !elementRef?.current) return;
    const el = elementRef.current;

    const showScrollbar = () => {
      el.classList.add('is-scrolling');
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        el.classList.remove('is-scrolling');
        timeoutRef.current = null;
      }, scrollTimeoutMs);
    };

    el.addEventListener('scroll', showScrollbar);
    el.addEventListener('wheel', showScrollbar);
    el.addEventListener('touchmove', showScrollbar);

    return () => {
      el.removeEventListener('scroll', showScrollbar);
      el.removeEventListener('wheel', showScrollbar);
      el.removeEventListener('touchmove', showScrollbar);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [elementRef, isActive]);
}
