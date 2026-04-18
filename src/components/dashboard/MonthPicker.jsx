import { useState, useRef, useEffect, useCallback } from 'react';
import { MONTH_ABBREVS } from '@/lib/constants';
import { formatMonthLabel } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';

export default function MonthPicker({ year, month, onChange, disabled }) {
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [displayYear, setDisplayYear] = useState(year);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);

  useEffect(() => {
    if (isOpen) setDisplayYear(year);
  }, [isOpen, year]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (popoverRef.current?.contains(e.target)) return;
      setIsOpen(false);
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [isOpen]);

  const positionPopover = useCallback(() => {
    if (!triggerRef.current || !popoverRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const pop = popoverRef.current;
    const gap = 6;

    const spaceBelow = window.innerHeight - rect.bottom;
    const popoverHeight = 220;

    if (spaceBelow < popoverHeight + gap && rect.top > popoverHeight + gap) {
      pop.style.top = '';
      pop.style.bottom = (window.innerHeight - rect.top + gap) + 'px';
    } else {
      pop.style.bottom = '';
      pop.style.top = (rect.bottom + gap) + 'px';
    }
    pop.style.left = rect.left + 'px';

    requestAnimationFrame(() => {
      const width = pop.offsetWidth;
      const maxLeft = window.innerWidth - width - 16;
      let left = parseFloat(pop.style.left) || rect.left;
      if (left > maxLeft) left = maxLeft;
      if (left < 16) left = 16;
      pop.style.left = left + 'px';
    });
  }, []);

  useEffect(() => {
    if (isOpen) positionPopover();
  }, [isOpen, displayYear, positionPopover]);

  const handleMonthClick = (m) => {
    onChange(displayYear, m);
    setIsOpen(false);
  };

  const selectedValue = `${year}-${month}`;

  return (
    <div className="month-picker">
      <button
        ref={triggerRef}
        type="button"
        className="month-picker-trigger"
        onClick={(e) => { e.stopPropagation(); setIsOpen((prev) => !prev); }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        disabled={disabled}
      >
        <span className="month-picker-trigger__label">
          {formatMonthLabel(year, month)}
        </span>
        <svg
          className="month-picker-trigger__icon"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="1.5"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {isOpen && (
        <div
          ref={popoverRef}
          className="month-picker-popover is-open"
          role="listbox"
        >
          <div className="month-picker-year-row">
            <button
              type="button"
              className="month-picker-year-btn"
              aria-label={t('monthPicker.prevYear')}
              onClick={() => setDisplayYear((y) => y - 1)}
            >
              ←
            </button>
            <span className="month-picker-year-display">{displayYear}</span>
            <button
              type="button"
              className="month-picker-year-btn"
              aria-label={t('monthPicker.nextYear')}
              onClick={() => setDisplayYear((y) => y + 1)}
            >
              →
            </button>
          </div>
          <div className="month-picker-grid">
            {MONTH_ABBREVS.map((abbrev, i) => {
              const m = i + 1;
              const value = `${displayYear}-${m}`;
              return (
                <button
                  key={m}
                  type="button"
                  className={`month-picker-item${value === selectedValue ? ' is-selected' : ''}`}
                  role="option"
                  aria-selected={value === selectedValue}
                  onClick={() => handleMonthClick(m)}
                >
                  {abbrev}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
