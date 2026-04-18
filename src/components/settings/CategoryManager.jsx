import { useState, useRef, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';

function InlineInput({ defaultValue = '', placeholder, onConfirm, onCancel, confirmLabel, cancelLabel }) {
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
      <button type="button" className="category-item__btn" onClick={() => onConfirm(value)}>{confirmLabel}</button>
      <button type="button" className="category-item__btn" onClick={onCancel}>{cancelLabel}</button>
    </div>
  );
}

export default function CategoryManager({ expenseCategories, incomeCategories, onAdd, onRename, onDelete, loading, confirm, onError }) {
  const { t } = useLanguage();
  const [addingType, setAddingType] = useState(null);
  const [renamingKey, setRenamingKey] = useState(null);
  const [openGroups, setOpenGroups] = useState({ expense: false, income: false });
  const expenseRef = useRef(null);
  const incomeRef = useRef(null);
  const groupRefs = { expense: expenseRef, income: incomeRef };
  const toggleGroup = (type) => setOpenGroups((s) => {
    const isMobile = window.matchMedia('(max-width: 600px)').matches;
    if (isMobile) {
      const allClosed = Object.fromEntries(Object.keys(s).map((key) => [key, false]));
      return { ...allClosed, [type]: !s[type] };
    }
    return { ...s, [type]: !s[type] };
  });
  useEffect(() => {
    if (!window.matchMedia('(max-width: 600px)').matches) return;
    const openKey = Object.keys(openGroups).find((k) => openGroups[k]);
    const el = openKey ? groupRefs[openKey].current : null;
    const container = el?.closest('.usm__content');
    if (el && container) container.scrollTop = el.offsetTop - container.offsetTop;
  }, [openGroups]);

  const handleAdd = async (type, name) => {
    if (!name?.trim()) { setAddingType(null); return; }
    try {
      await onAdd(type, name.trim());
    } catch (err) {
      onError?.(err.message || t('settings.category.addFailed'));
    }
    setAddingType(null);
  };

  const handleRename = async (type, oldName, newName) => {
    if (!newName?.trim() || newName.trim() === oldName) { setRenamingKey(null); return; }
    try {
      await onRename(type, oldName, newName.trim());
    } catch (err) {
      onError?.(err.message || t('settings.category.renameFailed'));
    }
    setRenamingKey(null);
  };

  const handleDelete = async (type, name) => {
    const ok = await confirm(t('settings.category.deleteConfirm', { name }), { danger: true });
    if (!ok) return;
    try {
      await onDelete(type, name);
    } catch (err) {
      onError?.(err.message || t('settings.category.deleteFailed'));
    }
  };

  const renderList = (type, cats) => {
    const isOpen = openGroups[type];
    const groupLabel = type === 'expense' ? t('settings.category.expenseCategories') : t('settings.category.incomeCategories');
    const addPlaceholder = type === 'expense' ? t('settings.category.expensePlaceholder') : t('settings.category.incomePlaceholder');
    const addAriaLabel = type === 'expense' ? t('settings.category.addExpenseAriaLabel') : t('settings.category.addIncomeAriaLabel');
    return (
    <div className="category-group" ref={groupRefs[type]}>
      <div className="category-group__header" onClick={() => toggleGroup(type)} style={{ cursor: 'pointer', userSelect: 'none' }}>
        <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" style={{ width: 14, height: 14, flexShrink: 0, transition: 'transform 0.2s', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
            <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z" clipRule="evenodd" />
          </svg>
          {groupLabel}
        </h4>
        {isOpen && (addingType === type ? (
          <div className="category-group__inline-add" onClick={(e) => e.stopPropagation()}>
            <InlineInput
              placeholder={addPlaceholder}
              onConfirm={(v) => handleAdd(type, v)}
              onCancel={() => setAddingType(null)}
              confirmLabel={t('common.confirm')}
              cancelLabel={t('common.cancel')}
            />
          </div>
        ) : (
          <button type="button" className="btn-add-category" disabled={loading} onClick={(e) => { e.stopPropagation(); setAddingType(type); }} aria-label={addAriaLabel}>
            {t('settings.category.addBtn')}
          </button>
        ))}
      </div>
      {isOpen && <ul className="category-list">
        {cats.map((cat) => (
          <li key={cat} className="category-item">
            {renamingKey === `${type}:${cat}` ? (
              <InlineInput
                defaultValue={cat}
                placeholder={t('settings.category.newNamePlaceholder')}
                onConfirm={(v) => handleRename(type, cat, v)}
                onCancel={() => setRenamingKey(null)}
                confirmLabel={t('common.confirm')}
                cancelLabel={t('common.cancel')}
              />
            ) : (
              <>
                <span className="category-item__name">{cat}</span>
                <div className="category-item__actions">
                  <button type="button" className="category-item__btn" disabled={loading} onClick={() => setRenamingKey(`${type}:${cat}`)}>{t('settings.category.rename')}</button>
                  <button type="button" className="category-item__btn category-item__btn--delete" disabled={loading} onClick={() => handleDelete(type, cat)}>{t('settings.category.delete')}</button>
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
