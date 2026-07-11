import { useState, useRef, useEffect } from 'react';

/**
 * 交易列表匯出鈕：點擊後開下拉選單（沿用 MoreMenu 的 class 與 click-outside 關閉範式），
 * 而非像過去一樣點一下就直接匯出。
 * 觸發鈕維持既有 btn-export-csv 樣式與圖示；選單本體沿用 more-menu-dropdown / more-menu-item。
 *
 * @param {string} triggerAriaLabel 觸發鈕的 aria-label
 * @param {string} primaryLabel 第一個選單項目的文字（隨情境變：匯出本月 / 匯出搜尋結果）
 * @param {boolean} primaryDisabled 第一個選單項目資料為空時 disabled
 * @param {() => void} onExportPrimary 點第一個選單項目
 * @param {string} rangeLabel 「自訂區間匯出…」文字
 * @param {() => void} onExportRange 點自訂區間匯出（永遠可用）
 */
export default function ExportMenu({
  triggerAriaLabel,
  primaryLabel,
  primaryDisabled,
  onExportPrimary,
  rangeLabel,
  onExportRange,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const btnRef = useRef(null);
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e) => {
      if (btnRef.current?.contains(e.target)) return;
      if (dropdownRef.current?.contains(e.target)) return;
      setIsOpen(false);
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [isOpen]);

  return (
    <div className="export-menu-wrapper">
      <button
        ref={btnRef}
        type="button"
        className="btn-export-csv"
        onClick={(e) => { e.stopPropagation(); setIsOpen((v) => !v); }}
        aria-label={triggerAriaLabel}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 0 0-2.25 2.25v9a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25H15m0-3-3-3m0 0-3 3m3-3V15" />
        </svg>
      </button>
      <div
        ref={dropdownRef}
        className={`more-menu-dropdown${isOpen ? ' is-open' : ''}`}
        role="menu"
      >
        <button
          type="button"
          role="menuitem"
          className="more-menu-item"
          disabled={primaryDisabled}
          onClick={() => { setIsOpen(false); onExportPrimary(); }}
        >
          <span>{primaryLabel}</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="more-menu-item"
          onClick={() => { setIsOpen(false); onExportRange(); }}
        >
          <span>{rangeLabel}</span>
        </button>
      </div>
    </div>
  );
}
