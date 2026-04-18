import { useState, useEffect, useRef } from 'react';
import Modal from '@/components/common/Modal';
import { useScrollbarOnScroll } from '@/hooks/useScrollbarOnScroll';
import CategoryManager from './CategoryManager';
import AccountManager from './AccountManager';
import { useSettings } from '@/hooks/useSettings';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useToast } from '@/contexts/ToastContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { TABS } from './unified/UnifiedTabIcons';
import ThemePanel from './unified/ThemePanel';
import NotificationPanel from './unified/NotificationPanel';
import SubscriptionPanel from './unified/SubscriptionPanel';

// ─── Options Panel ────────────────────────────────────────────────
function OptionsPanel({ isOpen, confirm, toast }) {
  const { t, lang, toggleLang } = useLanguage();
  const {
    expenseCategories, incomeCategories, loading, loadError,
    loadSettingsData, addCategory, renameCategory, deleteCategory,
  } = useSettings();

  useEffect(() => {
    if (isOpen) loadSettingsData();
  }, [isOpen, loadSettingsData]);

  return (
    <div className="usm-panel">
      <section className="settings-manage__section">
        <h3 className="settings-manage__section-title">{t('settings.language.title')}</h3>
        <div className="theme-language-toggle">
          <div className="theme-language-toggle__buttons">
            <button
              type="button"
              className={`theme-language-toggle__btn${lang === 'zh' ? ' is-active' : ''}`}
              onClick={() => lang !== 'zh' && toggleLang()}
              aria-pressed={lang === 'zh'}
            >
              {t('settings.language.zh')}
            </button>
            <button
              type="button"
              className={`theme-language-toggle__btn${lang === 'en' ? ' is-active' : ''}`}
              onClick={() => lang !== 'en' && toggleLang()}
              aria-pressed={lang === 'en'}
            >
              {t('settings.language.en')}
            </button>
          </div>
        </div>
      </section>

      {loadError && <div className="auth-error" style={{ marginBottom: '1rem' }} role="alert">{loadError}</div>}

      <section className="settings-manage__section">
        <h3 className="settings-manage__section-title">{t('settings.category.sectionTitle')}</h3>
        {loading ? <p className="settings-manage__loading">{t('common.loadingDots')}</p> : (
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
  const { t } = useLanguage();
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
        <h3 className="settings-manage__section-title">{t('settings.account.sectionTitle')}</h3>
        {loading ? <p className="settings-manage__loading">{t('common.loadingDots')}</p> : (
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
  const { t } = useLanguage();

  useEffect(() => {
    if (!isOpen) setActiveTab('theme');
  }, [isOpen]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="usm" titleId="usm-title">
      <div className="usm__backdrop" onClick={onClose} />
      <div ref={dialogRef} className="usm__dialog" onClick={(e) => e.stopPropagation()}>
        <h2 id="usm-title" className="sr-only">{t('settings.title')}</h2>
        <button type="button" className="usm__close" aria-label={t('settings.close')} onClick={onClose}>×</button>

        {/* Body */}
        <div className="usm__body">

          {/* Sidebar (desktop) */}
          <nav className="usm__sidebar" aria-label={t('settings.settingsCategories')}>
            {TABS.map(({ id, labelKey, Icon }) => (
              <button
                key={id}
                type="button"
                className={`usm__nav-item${activeTab === id ? ' is-active' : ''}`}
                onClick={() => setActiveTab(id)}
                aria-current={activeTab === id ? 'page' : undefined}
              >
                <Icon />
                <span>{t(labelKey)}</span>
              </button>
            ))}
          </nav>

          {/* Tab bar (mobile) */}
          <div className="usm__tabs" role="tablist">
            {TABS.map(({ id, labelKey, Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                className={`usm__tab${activeTab === id ? ' is-active' : ''}`}
                onClick={() => setActiveTab(id)}
                title={t(labelKey)}
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
