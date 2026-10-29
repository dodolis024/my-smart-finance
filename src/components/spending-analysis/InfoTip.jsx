import { useState, useEffect, useLayoutEffect, useRef, useId } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';

// 說明框離視窗邊緣至少留這麼多
const EDGE_GAP = 8;

const InfoIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.75Z" />
  </svg>
);

/**
 * 接在文字後面的小 i：點了才在下方出現說明，再點一次、點外面或按 Esc 收起來。
 * 「怎麼算的」這種不是每次都要看的說明放這裡，畫面上只留結論與數字。
 * 說明框預設往右展開，右邊放不下（例如最右邊那張卡片）就改成往左。
 */
export default function InfoTip({ children }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [alignEnd, setAlignEnd] = useState(false);
  const wrapRef = useRef(null);
  const tipRef = useRef(null);
  const tipId = useId();

  useLayoutEffect(() => {
    if (!open) {
      setAlignEnd(false);
      return;
    }
    const tip = tipRef.current;
    if (tip && tip.getBoundingClientRect().right > window.innerWidth - EDGE_GAP) setAlignEnd(true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    // 在彈窗裡（例如建立旅程）：Esc 只收起說明，不要連彈窗一起關掉
    const handleKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [open]);

  return (
    <span className="analysis-info" ref={wrapRef}>
      <button
        type="button"
        className="analysis-info__btn"
        aria-label={t('spendingAnalysis.info')}
        aria-expanded={open}
        aria-controls={tipId}
        onClick={() => setOpen((v) => !v)}
      >
        <InfoIcon />
      </button>
      {open && (
        <span id={tipId} ref={tipRef} role="note" className={`analysis-info__tip${alignEnd ? ' is-end' : ''}`}>
          {children}
        </span>
      )}
    </span>
  );
}
