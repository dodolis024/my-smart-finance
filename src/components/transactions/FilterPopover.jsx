import { useRef, useEffect } from 'react';
import { TIMING, DEBOUNCE } from '@/lib/constants';
import { debounce } from '@/lib/utils';
import { useScrollbarOnScroll } from '@/hooks/useScrollbarOnScroll';
import { useLanguage } from '@/contexts/LanguageContext';

export default function FilterPopover({
  isOpen,
  anchorRef,
  kind,
  items,
  selected,
  onSelect,
  onSelectAll,
  onClearAll,
  onClose,
}) {
  const { t } = useLanguage();
  const popoverRef = useRef(null);
  useScrollbarOnScroll(popoverRef, isOpen);

  // Position after render
  useEffect(() => {
    if (!isOpen || !anchorRef?.current || !popoverRef.current) return;
    const pop = popoverRef.current;
    const anchorEl = anchorRef.current;
    const rect = anchorEl.getBoundingClientRect();
    const gutter = 8;

    pop.style.left = rect.left + 'px';
    pop.style.top = rect.bottom + 4 + 'px';

    requestAnimationFrame(() => {
      if (!popoverRef.current) return;
      const popRect = pop.getBoundingClientRect();
      const vh = window.innerHeight;
      const vw = window.innerWidth;

      if (popRect.bottom > vh - gutter) {
        const spaceAbove = rect.top;
        if (spaceAbove >= popRect.height + gutter) {
          pop.style.top = rect.top - popRect.height - 4 + 'px';
        } else {
          pop.style.top = Math.max(gutter, vh - popRect.height - gutter) + 'px';
        }
      }

      const updatedRect = pop.getBoundingClientRect();
      if (updatedRect.right > vw - gutter) {
        pop.style.left = vw - popRect.width - gutter + 'px';
      }
      if (parseInt(pop.style.left, 10) < gutter) {
        pop.style.left = gutter + 'px';
      }
    });
  }, [isOpen, anchorRef]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e) => {
      if (popoverRef.current?.contains(e.target)) return;
      if (anchorRef?.current && (e.target === anchorRef.current || anchorRef.current.contains(e.target))) return;
      onClose();
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen, anchorRef, onClose]);

  // Close on scroll (with brief ignore window after filter changes cause scroll)
  useEffect(() => {
    if (!isOpen) return;
    const ignoreUntil = { value: Date.now() + TIMING.FILTER_IGNORE_SCROLL_MS };
    const handleScroll = debounce(() => {
      if (Date.now() < ignoreUntil.value) return;
      onClose();
    }, DEBOUNCE.SCROLL_MS);
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [isOpen, onClose]);

  if (!isOpen || !anchorRef?.current) return null;

  return (
    <div
      ref={popoverRef}
      className="filter-popover scrollbar-on-scroll is-open"
      role="dialog"
      aria-label={t('transaction.filterOptionsAria')}
    >
      <div className="filter-popover__actions">
        <button type="button" className="filter-popover__action" onClick={onSelectAll}>
          {t('transaction.selectAll')}
        </button>
        <button type="button" className="filter-popover__action" onClick={onClearAll}>
          {t('transaction.clearFilter')}
        </button>
      </div>
      <div className="filter-popover__list">
        {items.map((item) => (
          <label key={item}>
            <input
              type="checkbox"
              value={item}
              checked={selected.includes(item)}
              onChange={() => onSelect(item)}
            />
            {item}
          </label>
        ))}
      </div>
    </div>
  );
}
