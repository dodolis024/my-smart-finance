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

  const renderList = (type, cats) => (
    <div className="category-group">
      <div className="category-group__header">
        <h4>{type === 'expense' ? '支出類別' : '收入類別'}</h4>
        {addingType === type ? (
          <div className="category-group__inline-add">
            <InlineInput
              placeholder={type === 'expense' ? '輸入支出類別名稱' : '輸入收入類別名稱'}
              onConfirm={(v) => handleAdd(type, v)}
              onCancel={() => setAddingType(null)}
            />
          </div>
        ) : (
          <button type="button" className="btn-add-category" disabled={loading} onClick={() => setAddingType(type)} aria-label={type === 'expense' ? '新增支出類別' : '新增收入類別'}>
            + 新增
          </button>
        )}
      </div>
      <ul className="category-list">
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
      </ul>
    </div>
  );

  return (
    <div className="category-manager">
      {renderList('expense', expenseCategories)}
      {renderList('income', incomeCategories)}
    </div>
  );
}
