// ⊕ 放進去、⊖ 拿出來（旅程明細、大額消費共用）：圓框裡一個加號或減號，說明文字放在滑鼠提示與報讀
const AddIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
  </svg>
);

const RemoveIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
  </svg>
);

export default function EntryButton({ adding, label, onClick }) {
  return (
    <button type="button" className="analysis-entry-btn" aria-label={label} title={label} onClick={onClick}>
      {adding ? <AddIcon /> : <RemoveIcon />}
    </button>
  );
}
