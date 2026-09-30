import { useState } from 'react';
import AccountForm from './AccountForm';
import { formatMoney } from '@/lib/utils';
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

/** 卡片內容（清單項與拖曳浮層共用，兩者外觀必須一致） */
function AccountCardBody({ account, loading, t, dragHandle, onEdit, onDelete, interactive = true }) {
  const typeName = t(`settings.account.typeNames.${account.type}`) || account.type;
  return (
    <>
      <div className="account-item__header">
        <div className="account-item__title">
          {dragHandle}
          <span className="account-item__name">{account.name}</span>
        </div>
        <div className="account-item__actions">
          <button
            type="button"
            className="account-item__btn"
            disabled={loading}
            tabIndex={interactive ? undefined : -1}
            onClick={interactive ? () => onEdit(account) : undefined}
          >
            {t('common.edit')}
          </button>
          <button
            type="button"
            className="account-item__btn account-item__btn--delete"
            disabled={loading}
            tabIndex={interactive ? undefined : -1}
            onClick={interactive ? () => onDelete(account) : undefined}
          >
            {t('common.delete')}
          </button>
        </div>
      </div>
      <div className="account-item__details">
        <div className="account-item__detail">{t('settings.account.typeDetail')}{typeName}</div>
        {account.type === 'credit_card' && (
          <>
            {account.credit_limit && <div className="account-item__detail">{t('settings.account.creditLimitDetail')}{formatMoney(account.credit_limit)}</div>}
            {account.billing_day && <div className="account-item__detail">{t('settings.account.billingDayDetail', { day: account.billing_day })}</div>}
            {account.payment_due_day && <div className="account-item__detail">{t('settings.account.paymentDueDayDetail', { day: account.payment_due_day })}</div>}
          </>
        )}
      </div>
    </>
  );
}

function SortableAccountItem({ account, loading, t, onEdit, onDelete }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: account.id,
    disabled: loading,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    // 拖曳中隱藏原位置卡片，只讓 DragOverlay 的浮層可見
    ...(isDragging ? { opacity: 0 } : null),
  };

  return (
    <div ref={setNodeRef} style={style} className="account-item">
      <AccountCardBody
        account={account}
        loading={loading}
        t={t}
        onEdit={onEdit}
        onDelete={onDelete}
        dragHandle={(
          <button
            type="button"
            ref={setActivatorNodeRef}
            className="account-item__drag-handle"
            disabled={loading}
            aria-label={t('settings.account.dragToReorder')}
            {...attributes}
            {...listeners}
          >
            <DragHandleIcon />
          </button>
        )}
      />
    </div>
  );
}

export default function AccountManager({ accounts, onSave, onDelete, onReorderTo, loading, confirm, onError }) {
  const { t } = useLanguage();
  const [editingAccount, setEditingAccount] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const sensors = useSensors(
    // 需拖動 6px 才啟動，避免點擊／捲動被誤判為拖曳（比照類別排序）
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleEdit = (account) => {
    setEditingAccount(account);
    setShowForm(true);
  };

  const handleAdd = () => {
    setEditingAccount(null);
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingAccount(null);
  };

  const handleSave = async (payload, id) => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(payload, id);
      setShowForm(false);
      setEditingAccount(null);
    } catch (err) {
      onError?.(err.message || t('common.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (account) => {
    const ok = await confirm(t('settings.account.deleteConfirm', { name: account.name }), { danger: true });
    if (!ok) return;
    try {
      await onDelete(account.id);
    } catch (err) {
      onError?.(err.message || t('common.deleteFailed'));
    }
  };

  const handleDragEnd = async (event) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = accounts.map((a) => a.id);
    const oldIndex = ids.indexOf(active.id);
    const newIndex = ids.indexOf(over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    try {
      await onReorderTo?.(arrayMove(ids, oldIndex, newIndex));
    } catch (err) {
      onError?.(err.message || t('common.saveFailed'));
    }
  };

  if (showForm) {
    return (
      <AccountForm
        account={editingAccount}
        onSave={handleSave}
        onCancel={handleCancel}
        loading={loading || saving}
      />
    );
  }

  const activeAccount = activeId ? accounts.find((a) => a.id === activeId) : null;

  return (
    <div className="account-manager">
      <div className="accounts-header">
        <button type="button" className="btn-add-account" onClick={handleAdd} disabled={loading}>{t('settings.account.addBtn')}</button>
      </div>
      {accounts.length === 0 ? (
        <p className="account-manager__empty">{t('settings.account.noAccounts')}</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e) => setActiveId(e.active.id)}
          onDragCancel={() => setActiveId(null)}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={accounts.map((a) => a.id)} strategy={verticalListSortingStrategy}>
            <div className="accounts-list">
              {accounts.map((account) => (
                <SortableAccountItem
                  key={account.id}
                  account={account}
                  loading={loading}
                  t={t}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </SortableContext>
          <DragOverlay>
            {activeAccount ? (
              <div className="account-item account-item--overlay">
                <AccountCardBody
                  account={activeAccount}
                  loading={loading}
                  t={t}
                  interactive={false}
                  dragHandle={(
                    <button type="button" className="account-item__drag-handle" aria-hidden="true" tabIndex={-1}>
                      <DragHandleIcon />
                    </button>
                  )}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}
