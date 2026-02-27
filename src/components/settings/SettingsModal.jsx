import { useEffect, useRef } from 'react';
import Modal from '@/components/common/Modal';
import { useScrollbarOnScroll } from '@/hooks/useScrollbarOnScroll';
import CategoryManager from './CategoryManager';
import AccountManager from './AccountManager';
import { useSettings } from '@/hooks/useSettings';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useToast } from '@/contexts/ToastContext';

export default function SettingsModal({ isOpen, onClose }) {
  const {
    expenseCategories,
    incomeCategories,
    accounts,
    loading,
    loadError,
    loadSettingsData,
    addCategory,
    renameCategory,
    deleteCategory,
    saveAccount,
    deleteAccount,
  } = useSettings();

  const { confirm } = useConfirm();
  const toast = useToast();
  const dialogRef = useRef(null);
  useScrollbarOnScroll(dialogRef, isOpen);

  useEffect(() => {
    if (isOpen) loadSettingsData();
  }, [isOpen, loadSettingsData]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="settings-manage-modal" titleId="settings-modal-title">
      <div className="settings-manage-modal__backdrop" onClick={onClose} />
      <div ref={dialogRef} className="settings-manage-modal__dialog scrollbar-on-scroll" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="settings-manage-modal__close" aria-label="關閉" onClick={onClose}>×</button>
        <h2 id="settings-modal-title" className="settings-manage-modal__title">選項管理</h2>
        {loadError && (
          <div className="auth-error" style={{ marginBottom: '1rem' }} role="alert">
            {loadError}
          </div>
        )}
        <div className="settings-manage-grid">
          <section className="settings-manage__section settings-manage__categories">
            <h3 className="settings-manage__section-title">類別管理</h3>
            {loading ? (
              <p className="settings-manage__loading">載入中...</p>
            ) : (
              <CategoryManager
                expenseCategories={expenseCategories}
                incomeCategories={incomeCategories}
                onAdd={addCategory}
                onRename={renameCategory}
                onDelete={deleteCategory}
                loading={loading}
                confirm={confirm}
                onError={(msg) => toast.error(msg)}
              />
            )}
          </section>
          <section className="settings-manage__section settings-manage__accounts">
            <h3 className="settings-manage__section-title">支付工具管理</h3>
            {loading ? (
              <p className="settings-manage__loading">載入中...</p>
            ) : (
              <AccountManager
                accounts={accounts}
                onSave={saveAccount}
                onDelete={deleteAccount}
                loading={loading}
                confirm={confirm}
                onError={(msg) => toast.error(msg)}
              />
            )}
          </section>
        </div>
      </div>
    </Modal>
  );
}
