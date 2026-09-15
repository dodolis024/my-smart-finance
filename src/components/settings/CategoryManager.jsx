import { useState, useRef, useEffect, useMemo, useId } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import DisclosureToggle from './DisclosureToggle';
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
  const baseId = useId();
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
    const listId = `${baseId}-${type}`;
    return (
    <div className="category-group" ref={groupRefs[type]}>
      <div className="category-group__header disclosure-row" onClick={() => toggleGroup(type)}>
        <h4>{groupLabel}</h4>
        <div className="disclosure-right">
          <DisclosureToggle status={t('settings.category.count', { count: cats.length })} open={isOpen} controls={listId} />
        </div>
      </div>
      {isOpen && (
        <div id={listId}>
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
          {/* 新類別會加在最後面，所以新增入口也放在清單最下面：在哪輸入就出現在哪 */}
          {addingType === type ? (
            <div className="category-item category-add-editing">
              <InlineInput
                placeholder={addPlaceholder}
                onConfirm={(v) => handleAdd(type, v)}
                onCancel={() => setAddingType(null)}
                confirmLabel={t('common.confirm')}
                cancelLabel={t('common.cancel')}
              />
            </div>
          ) : (
            <button type="button" className="category-add-row" disabled={loading} onClick={() => setAddingType(type)} aria-label={addAriaLabel}>
              <span aria-hidden="true">＋</span>{t('settings.category.addCategoryRow')}
            </button>
          )}
        </div>
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
