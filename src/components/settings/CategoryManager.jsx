import { useState, useRef, useEffect, useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const DragHandleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 16, height: 16 }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
  </svg>
);

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

/** 拖曳浮層用的靜態卡片（跟著游標移動，內容與列表項一致但不可互動） */
function CategoryCardPreview({ cat, loading, t }) {
  return (
    <li className="category-item category-item--overlay">
      <button type="button" className="category-item__drag-handle" aria-hidden="true" tabIndex={-1}>
        <DragHandleIcon />
      </button>
      <span className="category-item__name">{cat}</span>
      <div className="category-item__actions">
        <button type="button" className="category-item__btn" disabled={loading} tabIndex={-1}>{t('settings.category.rename')}</button>
        <button type="button" className="category-item__btn category-item__btn--delete" disabled={loading} tabIndex={-1}>{t('settings.category.delete')}</button>
      </div>
    </li>
  );
}

function SortableCategoryItem({ type, cat, loading, isRenaming, t, onStartRename, onDelete, renameInput }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: cat,
    disabled: isRenaming || loading,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    // 拖曳中隱藏原位置項目，只讓 DragOverlay 的浮層卡片可見
    ...(isDragging ? { opacity: 0 } : null),
  };

  return (
    <li ref={setNodeRef} style={style} className="category-item">
      {isRenaming ? renameInput : (
        <>
          <button
            type="button"
            ref={setActivatorNodeRef}
            className="category-item__drag-handle"
            disabled={loading}
            aria-label={t('settings.category.dragToReorder')}
            {...attributes}
            {...listeners}
          >
            <DragHandleIcon />
          </button>
          <span className="category-item__name">{cat}</span>
          <div className="category-item__actions">
            <button type="button" className="category-item__btn" disabled={loading} onClick={() => onStartRename(type, cat)}>{t('settings.category.rename')}</button>
            <button type="button" className="category-item__btn category-item__btn--delete" disabled={loading} onClick={() => onDelete(type, cat)}>{t('settings.category.delete')}</button>
          </div>
        </>
      )}
    </li>
  );
}

export default function CategoryManager({ expenseCategories, incomeCategories, onAdd, onRename, onDelete, onReorderTo, loading, confirm, onError }) {
  const { t } = useLanguage();
  const [addingType, setAddingType] = useState(null);
  const [renamingKey, setRenamingKey] = useState(null);
  const [openGroups, setOpenGroups] = useState({ expense: false, income: false });
  const [activeItem, setActiveItem] = useState(null); // { type, cat }：目前拖曳中的項目
  const expenseRef = useRef(null);
  const incomeRef = useRef(null);
  const groupRefs = useMemo(() => ({ expense: expenseRef, income: incomeRef }), []);
  const sensors = useSensors(
    // 需拖動 6px 才啟動,避免點擊/捲動被誤判為拖曳(手機捲動也因此不受影響)
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
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
  }, [openGroups, groupRefs]);

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

  const handleDragEnd = (type, cats, event) => {
    setActiveItem(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = cats.indexOf(active.id);
    const newIndex = cats.indexOf(over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onReorderTo?.(type, arrayMove(cats, oldIndex, newIndex));
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
      {isOpen && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e) => setActiveItem({ type, cat: e.active.id })}
          onDragCancel={() => setActiveItem(null)}
          onDragEnd={(e) => handleDragEnd(type, cats, e)}
        >
          <SortableContext items={cats} strategy={verticalListSortingStrategy}>
            <ul className="category-list">
              {cats.map((cat) => (
                <SortableCategoryItem
                  key={cat}
                  type={type}
                  cat={cat}
                  loading={loading}
                  isRenaming={renamingKey === `${type}:${cat}`}
                  t={t}
                  onStartRename={(ty, c) => setRenamingKey(`${ty}:${c}`)}
                  onDelete={handleDelete}
                  renameInput={(
                    <InlineInput
                      defaultValue={cat}
                      placeholder={t('settings.category.newNamePlaceholder')}
                      onConfirm={(v) => handleRename(type, cat, v)}
                      onCancel={() => setRenamingKey(null)}
                      confirmLabel={t('common.confirm')}
                      cancelLabel={t('common.cancel')}
                    />
                  )}
                />
              ))}
            </ul>
          </SortableContext>
          <DragOverlay>
            {activeItem?.type === type ? <CategoryCardPreview cat={activeItem.cat} loading={loading} t={t} /> : null}
          </DragOverlay>
        </DndContext>
      )}
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
