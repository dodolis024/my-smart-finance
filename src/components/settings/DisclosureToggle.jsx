// 設定頁共用的展開入口：右側「狀態文字 ⌄」。
// 點擊交給外層整列 header 的 onClick 處理；這顆 button 只提供語意（aria-expanded）
// 與鍵盤操作——按 Enter/Space 產生的 click 會冒泡到 header，所以這裡不綁 onClick，
// 否則會跟 header 各觸發一次、開了又關。
export function ChevronDown({ open }) {
  return (
    <svg className={`disclosure-chevron${open ? ' is-open' : ''}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
    </svg>
  );
}

export default function DisclosureToggle({ status, open, controls }) {
  return (
    <button type="button" className="disclosure-toggle" aria-expanded={open} aria-controls={controls}>
      {status != null && <span className="disclosure-toggle__status">{status}</span>}
      <ChevronDown open={open} />
    </button>
  );
}
