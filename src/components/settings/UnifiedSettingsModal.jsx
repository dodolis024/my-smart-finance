import { useState, useEffect, useRef, useLayoutEffect, useMemo, useCallback } from 'react';
import Modal from '@/components/common/Modal';
import { useScrollbarOnScroll } from '@/hooks/useScrollbarOnScroll';
import CategoryManager from './CategoryManager';
import AccountManager from './AccountManager';
import { useSettings } from '@/hooks/useSettings';
import { useTheme } from '@/hooks/useTheme';
import { useReminderSettings } from '@/hooks/useReminderSettings';
import { useSubscriptions } from '@/hooks/useSubscriptions';
import { useDashboard } from '@/hooks/useDashboard';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useToast } from '@/contexts/ToastContext';

// ─── Reminder: Timezones ──────────────────────────────────────────
const COMMON_TIMEZONES = [
  { value: 'Pacific/Honolulu', label: '(UTC-10) 夏威夷' },
  { value: 'America/Anchorage', label: '(UTC-9) 阿拉斯加' },
  { value: 'America/Los_Angeles', label: '(UTC-8) 美西（洛杉磯）' },
  { value: 'America/Denver', label: '(UTC-7) 美國山區' },
  { value: 'America/Chicago', label: '(UTC-6) 美國中部' },
  { value: 'America/New_York', label: '(UTC-5) 美東（紐約）' },
  { value: 'America/Sao_Paulo', label: '(UTC-3) 巴西（聖保羅）' },
  { value: 'Europe/London', label: '(UTC+0) 英國（倫敦）' },
  { value: 'Europe/Paris', label: '(UTC+1) 歐洲中部（巴黎）' },
  { value: 'Europe/Helsinki', label: '(UTC+2) 歐洲東部（赫爾辛基）' },
  { value: 'Asia/Dubai', label: '(UTC+4) 杜拜' },
  { value: 'Asia/Kolkata', label: '(UTC+5:30) 印度' },
  { value: 'Asia/Bangkok', label: '(UTC+7) 泰國（曼谷）' },
  { value: 'Asia/Shanghai', label: '(UTC+8) 中國（上海）' },
  { value: 'Asia/Taipei', label: '(UTC+8) 台灣（台北）' },
  { value: 'Asia/Hong_Kong', label: '(UTC+8) 香港' },
  { value: 'Asia/Singapore', label: '(UTC+8) 新加坡' },
  { value: 'Asia/Tokyo', label: '(UTC+9) 日本（東京）' },
  { value: 'Asia/Seoul', label: '(UTC+9) 韓國（首爾）' },
  { value: 'Australia/Sydney', label: '(UTC+11) 澳洲（雪梨）' },
  { value: 'Pacific/Auckland', label: '(UTC+12) 紐西蘭（奧克蘭）' },
];

// ─── WheelPicker ─────────────────────────────────────────────────
const HOURS = Array.from({ length: 24 }, (_, i) => ({ value: i, label: String(i).padStart(2, '0') }));
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => ({
  value: m,
  label: String(m).padStart(2, '0'),
}));
const ITEM_H = 44;
const VISIBLE = 5;
const COPIES = 7;
const PAD = Math.floor(VISIBLE / 2) * ITEM_H;

function WheelPicker({ items, value, onChange, disabled = false }) {
  const scrollRef = useRef(null);
  const userScrollingRef = useRef(false);
  const endTimerRef = useRef(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const len = items.length;
  const midBase = Math.floor(COPIES / 2) * len;
  const getVal = (item) => (typeof item === 'object' ? item.value : item);
  const getLabel = (item) => (typeof item === 'object' ? String(item.label) : String(item));
  const findIdx = useCallback((val) => { const i = items.findIndex((it) => getVal(it) === val); return i >= 0 ? i : 0; }, [items]);

  const scrollTo = useCallback((lIdx, smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.style.scrollBehavior = smooth ? 'smooth' : 'auto';
    el.scrollTop = (midBase + lIdx) * ITEM_H;
  }, [midBase]);

  useLayoutEffect(() => { scrollTo(findIdx(value)); }, [scrollTo, findIdx, value]);

  const prevValueRef = useRef(value);
  useEffect(() => {
    if (prevValueRef.current !== value) {
      prevValueRef.current = value;
      if (!userScrollingRef.current) scrollTo(findIdx(value));
    }
  }, [value, scrollTo, findIdx]);

  const handleScroll = () => {
    userScrollingRef.current = true;
    clearTimeout(endTimerRef.current);
    endTimerRef.current = setTimeout(() => { userScrollingRef.current = false; }, 250);
    const el = scrollRef.current;
    if (!el) return;
    const gIdx = Math.round(el.scrollTop / ITEM_H);
    const lIdx = ((gIdx % len) + len) % len;
    onChangeRef.current(getVal(items[lIdx]));
    if (gIdx < midBase - len || gIdx > midBase + len * 2) {
      el.style.scrollBehavior = 'auto';
      el.scrollTop = (midBase + lIdx) * ITEM_H;
    }
  };

  const handleItemClick = (gIdx) => {
    if (disabled) return;
    const el = scrollRef.current;
    if (!el) return;
    el.style.scrollBehavior = 'smooth';
    el.scrollTop = gIdx * ITEM_H;
  };

  const allItems = useMemo(() => Array.from({ length: COPIES }, () => items).flat(), [items]);
  const currentLocalIdx = findIdx(value);

  return (
    <div className={`wheel-picker${disabled ? ' is-disabled' : ''}`}>
      <div className="wheel-picker__fade wheel-picker__fade--top" aria-hidden="true" />
      <div className="wheel-picker__fade wheel-picker__fade--bottom" aria-hidden="true" />
      <div className="wheel-picker__highlight" aria-hidden="true" />
      <div ref={scrollRef} className="wheel-picker__scroll" onScroll={handleScroll}>
        <div style={{ height: PAD, flexShrink: 0 }} aria-hidden="true" />
        {allItems.map((item, i) => {
          const lIdx = i % len;
          const isSelected = lIdx === currentLocalIdx;
          return (
            <div
              key={i}
              className={`wheel-picker__item${isSelected ? ' is-selected' : ''}`}
              onClick={() => handleItemClick(i)}
              aria-hidden={!isSelected}
            >
              {getLabel(item)}
            </div>
          );
        })}
        <div style={{ height: PAD, flexShrink: 0 }} aria-hidden="true" />
      </div>
    </div>
  );
}

// ─── Tab icons ────────────────────────────────────────────────────
const IconOptions = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
  </svg>
);
const IconReminder = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
  </svg>
);
const IconSubscription = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
  </svg>
);
const IconAccounts = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 0 0-2.25-2.25H15a3 3 0 1 1-6 0H5.25A2.25 2.25 0 0 0 3 12m18 0v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 9m18 0V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v3" />
  </svg>
);

const TABS = [
  { id: 'options', label: '類別管理', Icon: IconOptions },
  { id: 'accounts', label: '支付工具', Icon: IconAccounts },
  { id: 'reminder', label: '簽到提醒', Icon: IconReminder },
  { id: 'subscription', label: '訂閱管理', Icon: IconSubscription },
];

const THEME_OPTIONS = [
  {
    id: 'default',
    label: '奶茶',
    swatch: ['#b59c80', '#FAF9F6', '#dfdad3'],
  },
  {
    id: 'rose',
    label: '玫瑰',
    swatch: ['#c06373', '#fcf8f5', '#efd0d9'],
  },
  {
    id: 'gray',
    label: '石墨',
    swatch: ['#7d8287', '#f7f7f8', '#dddfe2'],
  },
];

// ─── Options Panel ────────────────────────────────────────────────
function OptionsPanel({ isOpen, confirm, toast }) {
  const {
    expenseCategories, incomeCategories, loading, loadError,
    loadSettingsData, addCategory, renameCategory, deleteCategory,
  } = useSettings();
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    if (isOpen) loadSettingsData();
  }, [isOpen, loadSettingsData]);

  return (
    <div className="usm-panel">
      {loadError && <div className="auth-error" style={{ marginBottom: '1rem' }} role="alert">{loadError}</div>}

      <section className="settings-manage__section">
        <h3 className="settings-manage__section-title">外觀主題</h3>
        <div className="theme-picker">
          {THEME_OPTIONS.map(({ id, label, swatch }) => (
            <button
              key={id}
              type="button"
              className={`theme-picker__item${theme === id ? ' is-active' : ''}`}
              onClick={() => setTheme(id)}
              aria-pressed={theme === id}
            >
              <span className="theme-picker__swatch">
                {swatch.map((color, i) => (
                  <span key={i} style={{ background: color }} />
                ))}
              </span>
              <span className="theme-picker__label">{label}</span>
              {theme === id && (
                <svg className="theme-picker__check" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </section>

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

// ─── Reminder Panel ───────────────────────────────────────────────
function ReminderPanel({ isOpen, toast }) {
  const { reminderSettings, loading, saving, loadReminderSettings, saveReminderSettings } = useReminderSettings();
  const [enabled, setEnabled] = useState(false);
  const [timezone, setTimezone] = useState('Asia/Taipei');
  const [hour, setHour] = useState(20);
  const [minute, setMinute] = useState(0);

  useEffect(() => {
    if (isOpen) loadReminderSettings();
  }, [isOpen, loadReminderSettings]);

  useEffect(() => {
    setEnabled(reminderSettings.enabled);
    setTimezone(reminderSettings.timezone);
    const [h, m] = (reminderSettings.time || '20:00').split(':').map(Number);
    setHour(h ?? 20);
    setMinute(Math.round((m ?? 0) / 5) * 5 % 60);
  }, [reminderSettings]);

  const handleSave = async () => {
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    try {
      await saveReminderSettings({ enabled, timezone, time: timeStr });
      toast.success('提醒設定已儲存！');
    } catch (err) {
      toast.error(err.message || '儲存失敗，請稍後再試。');
    }
  };

  const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const showDetectedHint = !loading && detectedTz && detectedTz !== timezone;

  return (
    <div className="usm-panel">
      <h3 className="settings-manage__section-title">簽到提醒</h3>
      {loading ? <p className="reminder-modal__loading">載入中...</p> : (
        <div className="reminder-modal__content">
          <p className="reminder-modal__desc">
            開啟後，系統會在你設定的時間以 email 提醒你記帳或簽到，避免連續記帳天數中斷。
          </p>
          <div className="reminder-modal__field">
            <label className="reminder-modal__toggle-label">
              <span>啟用 Email 提醒</span>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                className={`reminder-modal__toggle ${enabled ? 'is-on' : ''}`}
                onClick={() => setEnabled((v) => !v)}
              >
                <span className="reminder-modal__toggle-knob" />
              </button>
            </label>
          </div>
          <div className={`reminder-modal__settings ${!enabled ? 'is-disabled' : ''}`}>
            <div className="reminder-modal__field">
              <label className="reminder-modal__label" htmlFor="reminder-timezone">時區</label>
              <select
                id="reminder-timezone"
                className="reminder-modal__select"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                disabled={!enabled}
              >
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </select>
              {showDetectedHint && (
                <button
                  type="button"
                  className="reminder-modal__detect-btn"
                  onClick={() => setTimezone(detectedTz)}
                  disabled={!enabled}
                >
                  偵測到你目前的時區是 {detectedTz}，點此使用
                </button>
              )}
            </div>
            <div className="reminder-modal__field">
              <label className="reminder-modal__label">提醒時間</label>
              <div className="reminder-modal__time-wheels">
                <WheelPicker items={HOURS} value={hour} onChange={setHour} disabled={!enabled} />
                <span className="reminder-modal__time-sep" aria-hidden="true">:</span>
                <WheelPicker items={MINUTES} value={minute} onChange={setMinute} disabled={!enabled} />
              </div>
            </div>
          </div>
          <div className="reminder-modal__actions">
            <button
              type="button"
              className="reminder-modal__save-btn"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? '儲存中...' : '儲存設定'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Subscription Panel ───────────────────────────────────────────
const EMPTY_FORM = { name: '', amount: '', currency: 'TWD', category: '', payment_method: '', renewal_day: 1 };

function SubscriptionPanel({ isOpen, confirm, toast }) {
  const { categoriesExpense, accounts } = useSettings();
  const { currencies } = useDashboard();
  const { subscriptions, loading, loadSubscriptions, saveSubscription, deleteSubscription, toggleSubscription } = useSubscriptions();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) { loadSubscriptions(); setShowForm(false); setEditingId(null); }
  }, [isOpen, loadSubscriptions]);

  const setField = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const handleOpenAdd = () => { setForm(EMPTY_FORM); setEditingId(null); setShowForm(true); };
  const handleOpenEdit = (sub) => {
    setForm({ name: sub.name, amount: String(sub.amount), currency: sub.currency || 'TWD', category: sub.category || '', payment_method: sub.payment_method || '', renewal_day: sub.renewal_day });
    setEditingId(sub.id);
    setShowForm(true);
  };
  const handleCancel = () => { setShowForm(false); setEditingId(null); };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('請填寫訂閱名稱'); return; }
    const amount = parseFloat(form.amount);
    if (isNaN(amount) || amount <= 0) { toast.error('請填寫有效金額'); return; }
    const renewal_day = parseInt(form.renewal_day, 10);
    if (renewal_day < 1 || renewal_day > 31) { toast.error('扣款日請填入 1–31'); return; }
    setSaving(true);
    try {
      const result = await saveSubscription({ name: form.name.trim(), amount, currency: form.currency, category: form.category || null, payment_method: form.payment_method || null, renewal_day, is_active: true }, editingId);
      if (editingId) { toast.success('已更新訂閱。'); }
      else if (result?.transactionCreated) { toast.success('已新增訂閱，並自動建立今日交易！'); }
      else { toast.success('已新增訂閱！'); }
      setShowForm(false); setEditingId(null);
    } catch (err) {
      toast.error(err.message || '儲存失敗，請稍後再試。');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    const ok = await confirm('確定要刪除這筆訂閱嗎？', { danger: true });
    if (!ok) return;
    try { await deleteSubscription(id); toast.success('已刪除。'); }
    catch (err) { toast.error(err.message || '刪除失敗，請稍後再試。'); }
  };

  const handleToggle = async (id, current) => {
    try { await toggleSubscription(id, !current); }
    catch (err) { toast.error(err.message || '更新失敗，請稍後再試。'); }
  };

  return (
    <div className="usm-panel">
      <h3 className="settings-manage__section-title">訂閱管理</h3>
      {loading ? <p className="subscription-modal__loading">載入中...</p>
        : showForm ? (
          <div className="subscription-form">
            <div className="subscription-form__field">
              <label className="subscription-form__label" htmlFor="sub-name">訂閱名稱</label>
              <input id="sub-name" type="text" className="subscription-form__input" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="例：Netflix" maxLength={50} />
            </div>
            <div className="subscription-form__row">
              <div className="subscription-form__field subscription-form__field--fixed">
                <label className="subscription-form__label" htmlFor="sub-currency">幣別</label>
                <select id="sub-currency" className="subscription-form__select" value={form.currency} onChange={(e) => setField('currency', e.target.value)}>
                  {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="subscription-form__field subscription-form__field--grow">
                <label className="subscription-form__label" htmlFor="sub-amount">金額</label>
                <input id="sub-amount" type="number" className="subscription-form__input" value={form.amount} onChange={(e) => setField('amount', e.target.value)} placeholder="0" min="0" />
              </div>
            </div>
            <div className="subscription-form__row">
              <div className="subscription-form__field subscription-form__field--grow">
                <label className="subscription-form__label" htmlFor="sub-category">分類</label>
                <select id="sub-category" className="subscription-form__select" value={form.category} onChange={(e) => setField('category', e.target.value)}>
                  <option value="">請選擇分類</option>
                  {categoriesExpense.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="subscription-form__field subscription-form__field--grow">
                <label className="subscription-form__label" htmlFor="sub-payment">付款方式</label>
                <select id="sub-payment" className="subscription-form__select" value={form.payment_method} onChange={(e) => setField('payment_method', e.target.value)}>
                  <option value="">請選擇</option>
                  {accounts.map((a) => <option key={a.id} value={a.accountName ?? a.name}>{a.accountName ?? a.name}</option>)}
                </select>
              </div>
            </div>
            <div className="subscription-form__field">
              <label className="subscription-form__label" htmlFor="sub-day">每月扣款日</label>
              <div className="subscription-form__day-row">
                <input id="sub-day" type="number" className="subscription-form__input subscription-form__input--day" value={form.renewal_day} onChange={(e) => setField('renewal_day', e.target.value)} min="1" max="31" />
                <span className="subscription-form__day-hint">號（若當月無此日，自動調整為月底）</span>
              </div>
            </div>
            <div className="subscription-form__actions">
              <button type="button" className="subscription-form__cancel-btn" onClick={handleCancel} disabled={saving}>取消</button>
              <button type="button" className="subscription-form__save-btn" onClick={handleSave} disabled={saving}>{saving ? '儲存中...' : '儲存'}</button>
            </div>
          </div>
        ) : (
          <div className="subscription-list">
            {subscriptions.length === 0 ? (
              <p className="subscription-list__empty">尚未設定任何訂閱。</p>
            ) : (
              <ul className="subscription-list__items">
                {subscriptions.map((sub) => (
                  <li key={sub.id} className={`subscription-item${!sub.is_active ? ' subscription-item--inactive' : ''}`}>
                    <div className="subscription-item__main">
                      <span className="subscription-item__name">{sub.name}</span>
                      <span className="subscription-item__meta">{sub.currency} {Number(sub.amount).toLocaleString()} · 每月 {sub.renewal_day} 號</span>
                      {sub.payment_method && <span className="subscription-item__payment">{sub.payment_method}</span>}
                    </div>
                    <div className="subscription-item__actions">
                      <button type="button" role="switch" aria-checked={sub.is_active} className={`subscription-item__toggle${sub.is_active ? ' is-on' : ''}`} onClick={() => handleToggle(sub.id, sub.is_active)} aria-label={sub.is_active ? '停用' : '啟用'}>
                        <span className="subscription-item__toggle-knob" />
                      </button>
                      <button type="button" className="subscription-item__edit-btn" onClick={() => handleOpenEdit(sub)} aria-label="編輯">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" /></svg>
                      </button>
                      <button type="button" className="subscription-item__delete-btn" onClick={() => handleDelete(sub.id)} aria-label="刪除">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="subscription-list__footer">
              <button type="button" className="subscription-list__add-btn" onClick={handleOpenAdd}>+ 新增訂閱</button>
            </div>
          </div>
        )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────
export default function UnifiedSettingsModal({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState('options');
  const dialogRef = useRef(null);
  useScrollbarOnScroll(dialogRef, isOpen);
  const { confirm } = useConfirm();
  const toast = useToast();

  useEffect(() => {
    if (!isOpen) setActiveTab('options');
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
            <div hidden={activeTab !== 'reminder'}><ReminderPanel isOpen={isOpen} toast={toast} /></div>
            <div hidden={activeTab !== 'subscription'}>
              <SubscriptionPanel isOpen={isOpen} confirm={confirm} toast={toast} />
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
