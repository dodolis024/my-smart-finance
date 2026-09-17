import { useState, useRef, useEffect, useCallback } from 'react';
import zh from '@/locales/zh';
import en from '@/locales/en';
import { getPeriodLabel, isCurrentPeriod, getPeriodNameKey } from '@/lib/period';
import { useLanguage } from '@/contexts/LanguageContext';

// 年份以十年為一組（2020 – 2029），翻頁一次翻一個年代——十年制才是人對年份的自然分組
const YEAR_BLOCK_SIZE = 10;
const yearBlockStart = (year) => Math.floor(year / YEAR_BLOCK_SIZE) * YEAR_BLOCK_SIZE;

/**
 * 期間選擇器：月模式維持原本的 12 宮格與「回這個月」鈕，年模式是新增的頁籤分支。
 *
 * @param {{granularity: 'month'|'year', year: number, month?: number}} period 目前檢視的期間
 * @param {Function} onChange              選定新期間時呼叫（同一種粒度內換錨點）
 * @param {Function} onGranularityChange   切換粒度時呼叫（兩個錨點都不動，由上層各自保管）
 * @param {{minYear: number, maxYear: number}|null} yearRange 使用者的交易年份範圍，範圍外的年份淡化停用
 * @param {Set<number>|null} monthsWithData 面板上這一年有紀錄的月份；沒紀錄的月只淡化、仍可點
 *        （空月太常見，點進去看「我是不是忘了記」本身就是合理需求，不該擋）
 * @param {Function} onDisplayYearChange 面板上翻年份時回報，讓上層去查那一年的月份資料
 * @param {boolean} yearDisabled 離線時停用「年」頁籤
 */
export default function PeriodPicker({
  period, onChange, onGranularityChange, yearRange, monthsWithData, onDisplayYearChange, yearDisabled, disabled,
}) {
  const { t, lang } = useLanguage();
  const { granularity, year, month } = period;
  // 月份名稱走語系檔陣列（與年度回顧的 monthlyChart.months 同一套做法）
  const monthNames = (lang === 'en' ? en : zh).common.monthsShort;
  const formatMonth = (y, m) => t('common.monthYear', { year: y, month: monthNames[m - 1] });
  const [isOpen, setIsOpen] = useState(false);
  const [displayYear, setDisplayYear] = useState(year);
  const [displayYearBlock, setDisplayYearBlock] = useState(() => yearBlockStart(year));
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setDisplayYear(year);
      setDisplayYearBlock(yearBlockStart(year));
    }
  }, [isOpen, year]);

  useEffect(() => {
    onDisplayYearChange?.(displayYear);
  }, [displayYear, onDisplayYearChange]);

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

  // 面板是 position: fixed，開著時捲動頁面它會定在原地蓋住內容（手機上特別明顯）。
  // 一偵測到捲動就立刻關：debounce 是等捲動「停下來」才觸發，手指還在滑的整段時間
  // 面板都會黏在畫面上。用 capture 才收得到 .dashboard-column 內部的捲動。
  useEffect(() => {
    if (!isOpen) return;
    // 開啟瞬間可能還有前一個手勢的慣性捲動（或行動版網址列收合），給一個很短的忽略窗
    const openedAt = Date.now();
    const handleScroll = () => {
      if (Date.now() - openedAt < 150) return;
      setIsOpen(false);
    };
    window.addEventListener('scroll', handleScroll, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', handleScroll, { capture: true });
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
  }, [isOpen, displayYear, displayYearBlock, granularity, positionPopover]);

  const thisYear = new Date().getFullYear();
  // 未來年份與資料範圍外的年份都點不動；完全沒有交易的新帳號（yearRange 為 null）只擋未來年份。
  // 今年一律可點：元旦還沒記帳時今年不在範圍內，但「看今年」是最常用的操作
  const isYearSelectable = (y) =>
    y === thisYear ||
    (y < thisYear && (!yearRange || (y >= yearRange.minYear && y <= yearRange.maxYear)));

  const handleMonthClick = (m) => {
    onChange({ granularity: 'month', year: displayYear, month: m });
    setIsOpen(false);
  };

  const handleYearClick = (y) => {
    // 格子本身已 disabled；這裡再擋一次，避免日後有人拿掉 disabled 就選得到沒有資料的年份
    if (!isYearSelectable(y)) return;
    onChange({ granularity: 'year', year: y });
    setIsOpen(false);
  };

  const handleTodayClick = () => {
    const now = new Date();
    onChange(
      granularity === 'year'
        ? { granularity: 'year', year: now.getFullYear() }
        : { granularity: 'month', year: now.getFullYear(), month: now.getMonth() + 1 }
    );
    setIsOpen(false);
  };

  const periodName = t(getPeriodNameKey(granularity));
  const todayLabel = t('periodPicker.today', { period: periodName });

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
          {getPeriodLabel(period, formatMonth)}
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

      {!isCurrentPeriod(period) && (
        <button
          type="button"
          className="month-picker-today"
          onClick={handleTodayClick}
          disabled={disabled}
          aria-label={todayLabel}
          title={todayLabel}
        >
          <svg
            className="month-picker-today__icon"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="1.5"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
          </svg>
        </button>
      )}

      {isOpen && (
        <div
          ref={popoverRef}
          className="month-picker-popover is-open"
          role="listbox"
        >
          {onGranularityChange && (
          <div className="period-picker-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={granularity === 'month'}
              className={`period-picker-tab${granularity === 'month' ? ' is-active' : ''}`}
              onClick={() => onGranularityChange?.('month')}
            >
              {t('periodPicker.tabMonth')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={granularity === 'year'}
              className={`period-picker-tab${granularity === 'year' ? ' is-active' : ''}`}
              disabled={yearDisabled}
              title={yearDisabled ? t('periodPicker.yearOfflineHint') : undefined}
              onClick={() => onGranularityChange?.('year')}
            >
              {t('periodPicker.tabYear')}
            </button>
          </div>
          )}

          {granularity === 'year' ? (
            <>
              <div className="month-picker-year-row">
                <button
                  type="button"
                  className="month-picker-year-btn"
                  aria-label={t('periodPicker.prevYears')}
                  onClick={() => setDisplayYearBlock((b) => b - YEAR_BLOCK_SIZE)}
                >
                  ←
                </button>
                <span className="month-picker-year-display">
                  {displayYearBlock} – {displayYearBlock + YEAR_BLOCK_SIZE - 1}
                </span>
                <button
                  type="button"
                  className="month-picker-year-btn"
                  aria-label={t('periodPicker.nextYears')}
                  onClick={() => setDisplayYearBlock((b) => b + YEAR_BLOCK_SIZE)}
                >
                  →
                </button>
              </div>
              <div className="month-picker-grid month-picker-grid--years">
                {Array.from({ length: YEAR_BLOCK_SIZE }, (_, i) => displayYearBlock + i).map((y) => {
                  const selectable = isYearSelectable(y);
                  return (
                    <button
                      key={y}
                      type="button"
                      className={`month-picker-item${y === year ? ' is-selected' : ''}${selectable ? '' : ' is-empty'}`}
                      role="option"
                      aria-selected={y === year}
                      disabled={!selectable}
                      title={selectable ? undefined : t('periodPicker.yearNoData')}
                      onClick={() => handleYearClick(y)}
                    >
                      {y}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <div className="month-picker-year-row">
                <button
                  type="button"
                  className="month-picker-year-btn"
                  aria-label={t('periodPicker.prevYear')}
                  onClick={() => setDisplayYear((y) => y - 1)}
                >
                  ←
                </button>
                <span className="month-picker-year-display">{displayYear}</span>
                <button
                  type="button"
                  className="month-picker-year-btn"
                  aria-label={t('periodPicker.nextYear')}
                  onClick={() => setDisplayYear((y) => y + 1)}
                >
                  →
                </button>
              </div>
              <div className="month-picker-grid">
                {monthNames.map((name, i) => {
                  const m = i + 1;
                  const value = `${displayYear}-${m}`;
                  // 還沒查到資料（null）時一律照常顯示，不要先淡化再跳回來
                  const noData = monthsWithData ? !monthsWithData.has(m) : false;
                  return (
                    <button
                      key={m}
                      type="button"
                      className={`month-picker-item${value === selectedValue ? ' is-selected' : ''}${noData ? ' is-no-data' : ''}`}
                      role="option"
                      aria-selected={value === selectedValue}
                      title={noData ? t('periodPicker.monthNoData') : undefined}
                      onClick={() => handleMonthClick(m)}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
