import { useState } from 'react';
import AccountForm from './AccountForm';
import { formatMoney } from '@/lib/utils';
import { isAccountActive } from '@/lib/accountStatus';
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

/** 卡片內容（清單項、停用清單與拖曳浮層共用，三者外觀必須一致） */
function AccountCardBody({ account, loading, t, dragHandle, onEdit, onDelete, onToggleActive, interactive = true }) {
  const typeName = t(`settings.account.typeNames.${account.type}`) || account.type;
  const active = isAccountActive(account);
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
          {/* 剪卡、關戶走停用而不是刪除：歷史交易保留，只是不再出現在記帳表單 */}
          {onToggleActive && (
            <button
              type="button"
              className="account-item__btn"
              disabled={loading}
              tabIndex={interactive ? undefined : -1}
              onClick={interactive ? () => onToggleActive(account) : undefined}
            >
              {active ? t('settings.account.deactivate') : t('settings.account.activate')}
            </button>
          )}
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

function SortableAccountItem({ account, loading, t, onEdit, onDelete, onToggleActive }) {
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
        onToggleActive={onToggleActive}
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

export default function AccountManager({ accounts, onSave, onDelete, onSetActive, countSubscriptionsUsing, onReorderTo, loading, confirm, onError, currencies, defaultCurrency }) {
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

  const handleToggleActive = async (account) => {
    const active = isAccountActive(account);
    if (active) {
      // 停用不會動到訂閱：排程照樣記到這個帳戶名下，先讓使用者知道有幾個要改
      let message = t('settings.account.deactivateConfirm', { name: account.name });
      const subCount = countSubscriptionsUsing ? await countSubscriptionsUsing(account.name).catch(() => 0) : 0;
      if (subCount > 0) message += '\n' + t('settings.account.deactivateSubscriptions', { count: subCount });
      const ok = await confirm(message);
      if (!ok) return;
    }
    try {
      await onSetActive(account.id, !active);
    } catch (err) {
      onError?.(err.message || t('common.saveFailed'));
    }
  };

  const handleDragEnd = async (event) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    // 排序存的是整份帳戶（含停用）的 id 順序：在整份裡搬動，停用的留在原位，
    // 啟用中那一段的相對順序就是畫面上拖出來的結果
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
        currencies={currencies}
        defaultCurrency={defaultCurrency}
      />
    );
  }

  const activeAccount = activeId ? accounts.find((a) => a.id === activeId) : null;
  // 啟用中的可拖曳排序；停用的另成一區放最後，不參與拖曳
  const enabledAccounts = accounts.filter(isAccountActive);
  const disabledAccounts = accounts.filter((a) => !isAccountActive(a));

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
          <SortableContext items={enabledAccounts.map((a) => a.id)} strategy={verticalListSortingStrategy}>
            <div className="accounts-list">
              {enabledAccounts.map((account) => (
                <SortableAccountItem
                  key={account.id}
                  account={account}
                  loading={loading}
                  t={t}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onToggleActive={onSetActive ? handleToggleActive : undefined}
                />
              ))}
            </div>
          </SortableContext>
          {disabledAccounts.length > 0 && (
            <div className="accounts-inactive">
              <h4 className="accounts-inactive__title">{t('settings.account.inactiveTitle')}</h4>
              <div className="accounts-list">
                {disabledAccounts.map((account) => (
                  <div key={account.id} className="account-item account-item--inactive">
                    <AccountCardBody
                      account={account}
                      loading={loading}
                      t={t}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                      onToggleActive={onSetActive ? handleToggleActive : undefined}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
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
