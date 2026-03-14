import { useState } from 'react';

function InlineInput({ defaultValue = '', placeholder, onConfirm, onCancel }) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className="category-inline-input">
      <input
        type="text"
        className="category-inline-input__field"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onConfirm(value); }
          if (e.key === 'Escape') onCancel();
        }}
      />
      <button type="button" className="category-item__btn" onClick={() => onConfirm(value)}>確定</button>
      <button type="button" className="category-item__btn" onClick={onCancel}>取消</button>
    </div>
  );
}

export default function CategoryManager({ expenseCategories, incomeCategories, onAdd, onRename, onDelete, loading, confirm, onError }) {
  const [addingType, setAddingType] = useState(null);
  const [renamingKey, setRenamingKey] = useState(null);
  const [openGroups, setOpenGroups] = useState({ expense: false, income: false });
  const toggleGroup = (type) => setOpenGroups((s) => ({ ...s, [type]: !s[type] }));

  const handleAdd = async (type, name) => {
    if (!name?.trim()) { setAddingType(null); return; }
    try {
      await onAdd(type, name.trim());
    } catch (err) {
      onError?.(err.message || '新增失敗');
    }
    setAddingType(null);
  };

  const handleRename = async (type, oldName, newName) => {
    if (!newName?.trim() || newName.trim() === oldName) { setRenamingKey(null); return; }
    try {
      await onRename(type, oldName, newName.trim());
    } catch (err) {
      onError?.(err.message || '重新命名失敗');
    }
    setRenamingKey(null);
  };

  const handleDelete = async (type, name) => {
    const ok = await confirm(`確定要刪除類別「${name}」嗎？\n注意：既有交易的類別名稱會保留。`, { danger: true });
    if (!ok) return;
    try {
      await onDelete(type, name);
    } catch (err) {
      onError?.(err.message || '刪除失敗');
    }
  };

  const renderList = (type, cats) => {
    const isOpen = openGroups[type];
    return (
    <div className="category-group">
      <div className="category-group__header" onClick={() => toggleGroup(type)} style={{ cursor: 'pointer', userSelect: 'none' }}>
        <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" style={{ width: 14, height: 14, flexShrink: 0, transition: 'transform 0.2s', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
            <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z" clipRule="evenodd" />
          </svg>
          {type === 'expense' ? '支出類別' : '收入類別'}
        </h4>
        {isOpen && (addingType === type ? (
          <div className="category-group__inline-add" onClick={(e) => e.stopPropagation()}>
            <InlineInput
              placeholder={type === 'expense' ? '輸入支出類別名稱' : '輸入收入類別名稱'}
              onConfirm={(v) => handleAdd(type, v)}
              onCancel={() => setAddingType(null)}
            />
          </div>
        ) : (
          <button type="button" className="btn-add-category" disabled={loading} onClick={(e) => { e.stopPropagation(); setAddingType(type); }} aria-label={type === 'expense' ? '新增支出類別' : '新增收入類別'}>
            + 新增
          </button>
        ))}
      </div>
      {isOpen && <ul className="category-list">
        {cats.map((cat) => (
          <li key={cat} className="category-item">
            {renamingKey === `${type}:${cat}` ? (
              <InlineInput
                defaultValue={cat}
                placeholder="輸入新名稱"
                onConfirm={(v) => handleRename(type, cat, v)}
                onCancel={() => setRenamingKey(null)}
              />
            ) : (
              <>
                <span className="category-item__name">{cat}</span>
                <div className="category-item__actions">
                  <button type="button" className="category-item__btn" disabled={loading} onClick={() => setRenamingKey(`${type}:${cat}`)}>重新命名</button>
                  <button type="button" className="category-item__btn category-item__btn--delete" disabled={loading} onClick={() => handleDelete(type, cat)}>刪除</button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>}
    </div>
  );
  };

  return (
    <div className="category-manager">
      {renderList('expense', expenseCategories)}
      {renderList('income', incomeCategories)}
    </div>
  );
}
