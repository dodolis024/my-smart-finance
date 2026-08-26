import { useRef, useState, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';

const HOURS = Array.from({ length: 24 }, (_, i) => ({ value: i, label: String(i).padStart(2, '0') }));
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => ({
  value: m,
  label: String(m).padStart(2, '0'),
}));
const COPIES = 7;

// fallback 值：僅在 layout 尚未就緒、量不到實際尺寸時暫用，須與 CSS 現值一致
// （.wheel-picker__item 的 height 與 .wheel-picker 的 height ÷ item 高度）
function WheelPicker({ items, value, onChange, disabled = false, itemHeight: itemHeightFallback = 40, visibleCount: visibleCountFallback = 3 }) {
  const scrollRef = useRef(null);
  const userScrollingRef = useRef(false);
  const endTimerRef = useRef(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  // 選中哪一格是用 scrollTop 反推的，若這裡的尺寸與 CSS 實際渲染不符，
  // 顯示值與存入值就會整排錯位（曾因 CSS 改 44→40px 而 JS 仍寫 44 出過此問題）。
  // 故一律以 DOM 實測為準，CSS 是唯一真相來源，改版型不需要回頭同步這裡。
  const [metrics, setMetrics] = useState({ itemHeight: itemHeightFallback, visibleCount: visibleCountFallback });
  const { itemHeight, visibleCount } = metrics;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const measure = () => {
      const item = el.querySelector('.wheel-picker__item');
      if (!item) return;
      const h = item.getBoundingClientRect().height;
      const containerH = el.getBoundingClientRect().height;
      // 開啟動畫期間或尚未 layout 時會量到 0，此時保留現值不動
      if (h <= 0 || containerH <= 0) return;
      const vc = Math.max(1, Math.round(containerH / h));
      setMetrics((prev) =>
        Math.abs(prev.itemHeight - h) < 0.5 && prev.visibleCount === vc
          ? prev // 尺寸沒變就回傳原物件，避免無限量測→重繪循環
          : { itemHeight: h, visibleCount: vc }
      );
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const item = el.querySelector('.wheel-picker__item');
    if (item) ro.observe(item);
    return () => ro.disconnect();
  }, []);

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
