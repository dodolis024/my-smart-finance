import { useState, useEffect, useLayoutEffect, useRef, useId } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';

// 說明框離視窗邊緣至少留這麼多
const EDGE_GAP = 8;
// 滑鼠停一下才顯示（只是經過不會一路跳出來）；移開後稍等再收，滑鼠才來得及移到說明框上
const SHOW_DELAY = 300;
const HIDE_DELAY = 150;

const InfoIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.75Z" />
  </svg>
);

/**
 * 接在文字後面的小 i：滑鼠停在上面（或用鍵盤移到它上面）就在下方出現說明，移開就收起；
 * 點一下會固定打開，再點一次、點外面或按 Esc 收起來。
 * 「怎麼算的」這種不是每次都要看的說明放這裡，畫面上只留結論與數字。
 * 說明框預設往右展開，右邊放不下（例如最右邊那張卡片）就改成往左。
 */
export default function InfoTip({ children }) {
  const { t } = useLanguage();
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const open = pinned || hovered;
  const [alignEnd, setAlignEnd] = useState(false);
  const wrapRef = useRef(null);
  const tipRef = useRef(null);
  const timerRef = useRef(null);
  const tipId = useId();

  const later = (fn, ms) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(fn, ms);
  };
  const close = () => {
    clearTimeout(timerRef.current);
    setPinned(false);
    setHovered(false);
  };
  useEffect(() => () => clearTimeout(timerRef.current), []);

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
      if (!wrapRef.current?.contains(e.target)) close();
    };
    // 在彈窗裡（例如建立旅程）：Esc 只收起說明，不要連彈窗一起關掉
    const handleKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [open]);

  return (
    <span
      className="analysis-info"
      ref={wrapRef}
      onMouseEnter={() => later(() => setHovered(true), SHOW_DELAY)}
      onMouseLeave={() => later(() => setHovered(false), HIDE_DELAY)}
    >
      <button
        type="button"
        className="analysis-info__btn"
        aria-label={t('spendingAnalysis.info')}
        aria-expanded={open}
        aria-controls={tipId}
        // 滑過已經打開的：點了改成固定打開；已經固定的：點了收起（滑鼠還停在上面也收）
        onClick={() => {
          clearTimeout(timerRef.current);
          if (pinned) close();
          else setPinned(true);
        }}
        // 用鍵盤移過來才顯示；滑鼠點的時候按鈕也會拿到焦點，那時交給 onClick
        onFocus={(e) => { if (e.target.matches(':focus-visible')) setHovered(true); }}
        onBlur={() => setHovered(false)}
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
