import { useState, useEffect, useRef } from 'react';
import Modal from '@/components/common/Modal';
import { useScrollbarOnScroll } from '@/hooks/useScrollbarOnScroll';
import CategoryManager from './CategoryManager';
import AccountManager from './AccountManager';
import { useSettings } from '@/hooks/useSettings';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useToast } from '@/contexts/ToastContext';
import { TABS } from './unified/UnifiedTabIcons';
import ThemePanel from './unified/ThemePanel';
import NotificationPanel from './unified/NotificationPanel';
import SubscriptionPanel from './unified/SubscriptionPanel';

// ─── Options Panel ────────────────────────────────────────────────
function OptionsPanel({ isOpen, confirm, toast }) {
  const {
    expenseCategories, incomeCategories, loading, loadError,
    loadSettingsData, addCategory, renameCategory, deleteCategory,
  } = useSettings();

  useEffect(() => {
    if (isOpen) loadSettingsData();
  }, [isOpen, loadSettingsData]);

  return (
    <div className="usm-panel">
      {loadError && <div className="auth-error" style={{ marginBottom: '1rem' }} role="alert">{loadError}</div>}

      <section className="settings-manage__section">
        <h3 className="settings-manage__section-title">類別管理</h3>
        {loading ? <p className="settings-manage__loading">載入中...</p> : (
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
    </div>
  );
}

// ─── Accounts Panel ───────────────────────────────────────────────
function AccountsPanel({ isOpen, confirm, toast }) {
  const {
    accounts, loading, loadError,
    loadSettingsData, saveAccount, deleteAccount,
  } = useSettings();

  useEffect(() => {
    if (isOpen) loadSettingsData();
  }, [isOpen, loadSettingsData]);

  return (
    <div className="usm-panel">
      {loadError && <div className="auth-error" style={{ marginBottom: '1rem' }} role="alert">{loadError}</div>}
      <section className="settings-manage__section">
        <h3 className="settings-manage__section-title">支付工具管理</h3>
        {loading ? <p className="settings-manage__loading">載入中...</p> : (
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
  );
}

// ─── Main component ───────────────────────────────────────────────
export default function UnifiedSettingsModal({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState('theme');
  const dialogRef = useRef(null);
  useScrollbarOnScroll(dialogRef, isOpen);
  const { confirm } = useConfirm();
  const toast = useToast();

  useEffect(() => {
    if (!isOpen) setActiveTab('theme');
  }, [isOpen]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="usm" titleId="usm-title">
      <div className="usm__backdrop" onClick={onClose} />
      <div ref={dialogRef} className="usm__dialog" onClick={(e) => e.stopPropagation()}>
        <h2 id="usm-title" className="sr-only">設定</h2>
        <button type="button" className="usm__close" aria-label="關閉" onClick={onClose}>×</button>

        {/* Body */}
        <div className="usm__body">

          {/* Sidebar (desktop) */}
          <nav className="usm__sidebar" aria-label="設定分類">
            {TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                className={`usm__nav-item${activeTab === id ? ' is-active' : ''}`}
                onClick={() => setActiveTab(id)}
                aria-current={activeTab === id ? 'page' : undefined}
              >
                <Icon />
                <span>{label}</span>
              </button>
            ))}
          </nav>

          {/* Tab bar (mobile) */}
          <div className="usm__tabs" role="tablist">
            {TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                className={`usm__tab${activeTab === id ? ' is-active' : ''}`}
                onClick={() => setActiveTab(id)}
                title={label}
              >
                <Icon />
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="usm__content scrollbar-on-scroll">
            <div hidden={activeTab !== 'options'}><OptionsPanel isOpen={isOpen} confirm={confirm} toast={toast} /></div>
            <div hidden={activeTab !== 'accounts'}><AccountsPanel isOpen={isOpen} confirm={confirm} toast={toast} /></div>
            <div hidden={activeTab !== 'notification'}><NotificationPanel isOpen={isOpen} toast={toast} /></div>
            <div hidden={activeTab !== 'subscription'}>
              <SubscriptionPanel isOpen={isOpen} confirm={confirm} toast={toast} />
            </div>
            <div hidden={activeTab !== 'theme'}><ThemePanel /></div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
