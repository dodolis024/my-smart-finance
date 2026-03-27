import { useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';

const HOURS = Array.from({ length: 24 }, (_, i) => ({ value: i, label: String(i).padStart(2, '0') }));
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => ({
  value: m,
  label: String(m).padStart(2, '0'),
}));
const COPIES = 7;

function WheelPicker({ items, value, onChange, disabled = false, itemHeight = 44, visibleCount = 5 }) {
  const scrollRef = useRef(null);
  const userScrollingRef = useRef(false);
  const endTimerRef = useRef(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const pad = Math.floor(visibleCount / 2) * itemHeight;
  const len = items.length;
  const midBase = Math.floor(COPIES / 2) * len;
  const getVal = (item) => (typeof item === 'object' ? item.value : item);
  const getLabel = (item) => (typeof item === 'object' ? String(item.label) : String(item));
  const findIdx = useCallback((val) => { const i = items.findIndex((it) => getVal(it) === val); return i >= 0 ? i : 0; }, [items]);

  const scrollTo = useCallback((lIdx, smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.style.scrollBehavior = smooth ? 'smooth' : 'auto';
    el.scrollTop = (midBase + lIdx) * itemHeight;
  }, [midBase, itemHeight]);

  useLayoutEffect(() => { scrollTo(findIdx(value)); }, [scrollTo, findIdx, value]);

  const prevValueRef = useRef(value);
  useEffect(() => {
    if (prevValueRef.current !== value) {
      prevValueRef.current = value;
      if (!userScrollingRef.current) scrollTo(findIdx(value));
    }
  }, [value, scrollTo, findIdx]);

  const handleScroll = () => {
    userScrollingRef.current = true;
    clearTimeout(endTimerRef.current);
    endTimerRef.current = setTimeout(() => { userScrollingRef.current = false; }, 250);
    const el = scrollRef.current;
    if (!el) return;
    const gIdx = Math.round(el.scrollTop / itemHeight);
    const lIdx = ((gIdx % len) + len) % len;
    onChangeRef.current(getVal(items[lIdx]));
    if (gIdx < midBase - len || gIdx > midBase + len * 2) {
      el.style.scrollBehavior = 'auto';
      el.scrollTop = (midBase + lIdx) * itemHeight;
    }
  };

  const handleItemClick = (gIdx) => {
    if (disabled) return;
    const el = scrollRef.current;
    if (!el) return;
    el.style.scrollBehavior = 'smooth';
    el.scrollTop = gIdx * itemHeight;
  };

  const allItems = useMemo(() => Array.from({ length: COPIES }, () => items).flat(), [items]);
  const currentLocalIdx = findIdx(value);

  return (
    <div className={`wheel-picker${disabled ? ' is-disabled' : ''}`}>
      <div className="wheel-picker__fade wheel-picker__fade--top" aria-hidden="true" />
      <div className="wheel-picker__fade wheel-picker__fade--bottom" aria-hidden="true" />
      <div className="wheel-picker__highlight" aria-hidden="true" />
      <div ref={scrollRef} className="wheel-picker__scroll" onScroll={handleScroll}>
        <div style={{ height: pad, flexShrink: 0 }} aria-hidden="true" />
        {allItems.map((item, i) => {
          const lIdx = i % len;
          const isSelected = lIdx === currentLocalIdx;
          return (
            <div
              key={i}
              className={`wheel-picker__item${isSelected ? ' is-selected' : ''}`}
              onClick={() => handleItemClick(i)}
              aria-hidden={!isSelected}
            >
              {getLabel(item)}
            </div>
          );
        })}
        <div style={{ height: pad, flexShrink: 0 }} aria-hidden="true" />
      </div>
    </div>
  );
}

export { WheelPicker, HOURS, MINUTES };
