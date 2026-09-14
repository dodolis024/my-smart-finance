import { useState, useEffect, useRef } from 'react';
import Modal from '@/components/common/Modal';
import { useScrollbarOnScroll } from '@/hooks/useScrollbarOnScroll';
import CategoryManager from './CategoryManager';
import AccountManager from './AccountManager';
import { useSettings } from '@/hooks/useSettings';
import { useDashboard } from '@/hooks/useDashboard';
import { useDisplayPreferences, AMOUNT_MODES } from '@/hooks/useDisplayPreferences';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useToast } from '@/contexts/ToastContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { TABS } from './unified/UnifiedTabIcons';
import ThemePanel from './unified/ThemePanel';
import NotificationPanel from './unified/NotificationPanel';
import SubscriptionPanel from './unified/SubscriptionPanel';
import GuidePanel from './unified/GuidePanel';

const DEFAULT_TAB = 'theme';

// ─── Options Panel ────────────────────────────────────────────────
function OptionsPanel({ isOpen, confirm, toast }) {
  const { t, lang, toggleLang } = useLanguage();
  const {
    expenseCategories, incomeCategories, loading, loadError,
    loadSettingsData, addCategory, renameCategory, deleteCategory, reorderCategoriesTo,
  } = useSettings();
  const { currencies, defaultCurrency, fetchCurrencies, saveDefaultCurrency } = useDashboard();
  const { displayPreferences, loadDisplayPreferences, saveDisplayPreferences } = useDisplayPreferences();

  useEffect(() => {
    if (isOpen) {
      loadSettingsData();
      fetchCurrencies().catch(() => {});
      loadDisplayPreferences().catch(() => {});
    }
  }, [isOpen, loadSettingsData, fetchCurrencies, loadDisplayPreferences]);

  const handleDefaultCurrencyChange = async (e) => {
    const code = e.target.value;
    try {
      await saveDefaultCurrency(code);
    } catch (err) {
      toast.error(err?.message || t('settings.currency.saveError'));
    }
  };

  const handleDisplayPreferenceChange = async (patch, errorKey) => {
    try {
      await saveDisplayPreferences(patch);
    } catch (err) {
      toast.error(err?.message || t(errorKey));
    }
  };

  return (
    <div className="usm-panel">
      <section className="settings-manage__section">
        <h3 className="settings-manage__section-title">{t('settings.preferences.sectionTitle')}</h3>
        <div className="settings-list">
          <div className="settings-list__row">
            <div className="settings-list__text">
              <span className="settings-list__label" id="language-label">{t('settings.language.title')}</span>
            </div>
            <div className="theme-language-toggle__buttons" role="group" aria-labelledby="language-label">
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

          <div className="settings-list__row">
            <div className="settings-list__text">
              <label className="settings-list__label" htmlFor="default-currency">{t('settings.currency.title')}</label>
              <span className="settings-list__hint">{t('settings.currency.label')}</span>
            </div>
            <select
              id="default-currency"
              className="settings-currency__select"
              value={defaultCurrency}
              onChange={handleDefaultCurrencyChange}
            >
              {(currencies.includes(defaultCurrency) ? currencies : [defaultCurrency, ...currencies]).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="settings-list__row">
            <div className="settings-list__text">
              <label className="settings-list__label" htmlFor="display-currency">{t('settings.displayCurrency.title')}</label>
              <span className="settings-list__hint">{t('settings.displayCurrency.label')}</span>
            </div>
            <select
              id="display-currency"
              className="settings-currency__select"
              value={displayPreferences.currency}
              onChange={(e) => handleDisplayPreferenceChange({ currency: e.target.value }, 'settings.displayCurrency.saveError')}
            >
              {(currencies.includes(displayPreferences.currency) ? currencies : [displayPreferences.currency, ...currencies]).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="settings-list__row">
            <div className="settings-list__text">
              <span className="settings-list__label" id="amount-mode-label">{t('settings.amountMode.title')}</span>
            </div>
            <div className="theme-language-toggle__buttons" role="group" aria-labelledby="amount-mode-label">
              {AMOUNT_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`theme-language-toggle__btn${displayPreferences.amountMode === mode ? ' is-active' : ''}`}
                  onClick={() =>
                    displayPreferences.amountMode !== mode &&
                    handleDisplayPreferenceChange({ amountMode: mode }, 'settings.amountMode.saveError')
                  }
                  aria-pressed={displayPreferences.amountMode === mode}
                >
                  {t(`settings.amountMode.${mode}`)}
                </button>
              ))}
            </div>
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
            onReorderTo={reorderCategoriesTo}
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
  const [activeTab, setActiveTab] = useState(DEFAULT_TAB);
  const dialogRef = useRef(null);
  useScrollbarOnScroll(dialogRef, isOpen);
  const { confirm } = useConfirm();
  const toast = useToast();
  const { t } = useLanguage();

  useEffect(() => {
    if (!isOpen) setActiveTab(DEFAULT_TAB);
  }, [isOpen]);

  // 視窗從電腦寬度縮到手機時，僅限電腦的分頁在 tab bar 上沒有對應按鈕，
  // 停在那裡會變成切不回去，所以退回預設分頁
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 600px)');
    const sync = () => {
      if (mq.matches && TABS.find((tab) => tab.id === activeTab)?.desktopOnly) {
        setActiveTab(DEFAULT_TAB);
      }
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [activeTab]);

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
            {TABS.filter((tab) => !tab.desktopOnly).map(({ id, labelKey, Icon }) => (
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
            <div hidden={activeTab !== 'guide'}><GuidePanel /></div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
