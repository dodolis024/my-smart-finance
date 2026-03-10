import { useEffect, useState, useRef, useLayoutEffect, useMemo } from 'react';
import Modal from '@/components/common/Modal';
import { useScrollbarOnScroll } from '@/hooks/useScrollbarOnScroll';
import { useReminderSettings } from '@/hooks/useReminderSettings';
import { useToast } from '@/contexts/ToastContext';

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

// ── WheelPicker constants ────────────────────────────────────────────────────
const HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: String(i).padStart(2, '0'),
}));
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => ({
  value: m,
  label: String(m).padStart(2, '0'),
}));

const ITEM_H = 44;   // px per item
const VISIBLE = 5;   // visible rows (odd so selection is centred)
const COPIES = 7;    // repeat copies for infinite illusion
const PAD = Math.floor(VISIBLE / 2) * ITEM_H; // spacer height = 88 px

// ── WheelPicker component ────────────────────────────────────────────────────
function WheelPicker({ items, value, onChange, disabled = false }) {
  const scrollRef = useRef(null);
  const userScrollingRef = useRef(false);
  const endTimerRef = useRef(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const len = items.length;
  const midBase = Math.floor(COPIES / 2) * len; // index of middle-copy start

  const getVal = (item) => (typeof item === 'object' ? item.value : item);
  const getLabel = (item) => (typeof item === 'object' ? String(item.label) : String(item));

  const findIdx = (val) => {
    const i = items.findIndex((it) => getVal(it) === val);
    return i >= 0 ? i : 0;
  };

  /** Scroll so that local-index lIdx is centred, instantly or smoothly. */
  const scrollTo = (lIdx, smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.style.scrollBehavior = smooth ? 'smooth' : 'auto';
    el.scrollTop = (midBase + lIdx) * ITEM_H;
  };

  // Initialise on mount
  useLayoutEffect(() => {
    scrollTo(findIdx(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync when value is changed from outside (e.g. settings loaded)
  const prevValueRef = useRef(value);
  useEffect(() => {
    if (prevValueRef.current !== value) {
      prevValueRef.current = value;
      if (!userScrollingRef.current) scrollTo(findIdx(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleScroll = () => {
    // Mark user-initiated scroll so external sync is suppressed briefly
    userScrollingRef.current = true;
    clearTimeout(endTimerRef.current);
    endTimerRef.current = setTimeout(() => {
      userScrollingRef.current = false;
    }, 250);

    const el = scrollRef.current;
    if (!el) return;

    // Which global item is centred?
    const gIdx = Math.round(el.scrollTop / ITEM_H);
    const lIdx = ((gIdx % len) + len) % len;

    onChangeRef.current(getVal(items[lIdx]));

    // Infinite scroll: teleport silently when approaching boundary
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

  const allItems = useMemo(
    () => Array.from({ length: COPIES }, () => items).flat(),
    [items],
  );
  const currentLocalIdx = findIdx(value);

  return (
    <div className={`wheel-picker${disabled ? ' is-disabled' : ''}`}>
      {/* Gradient masks fade out non-selected rows */}
      <div className="wheel-picker__fade wheel-picker__fade--top" aria-hidden="true" />
      <div className="wheel-picker__fade wheel-picker__fade--bottom" aria-hidden="true" />
      {/* Selection-highlight lines */}
      <div className="wheel-picker__highlight" aria-hidden="true" />
      <div
        ref={scrollRef}
        className="wheel-picker__scroll"
        onScroll={handleScroll}
      >
        {/* Top spacer lets the first real item snap to centre */}
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
        {/* Bottom spacer mirrors the top */}
        <div style={{ height: PAD, flexShrink: 0 }} aria-hidden="true" />
      </div>
    </div>
  );
}

// ── ReminderSettingsModal ────────────────────────────────────────────────────
export default function ReminderSettingsModal({ isOpen, onClose }) {
  const {
    reminderSettings,
    loading,
    saving,
    loadReminderSettings,
    saveReminderSettings,
  } = useReminderSettings();

  const toast = useToast();
  const dialogRef = useRef(null);
  useScrollbarOnScroll(dialogRef, isOpen);

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
    // Round to nearest 5-minute interval
    setMinute(Math.round((m ?? 0) / 5) * 5 % 60);
  }, [reminderSettings]);

  const handleSave = async () => {
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    try {
      await saveReminderSettings({ enabled, timezone, time: timeStr });
      toast.success('提醒設定已儲存！');
      onClose();
    } catch (err) {
      toast.error(err.message || '儲存失敗，請稍後再試。');
    }
  };

  const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const showDetectedHint = !loading && detectedTz && detectedTz !== timezone;

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="reminder-modal" titleId="reminder-modal-title">
      <div className="reminder-modal__backdrop" onClick={onClose} />
      <div
        ref={dialogRef}
        className="reminder-modal__dialog scrollbar-on-scroll"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="reminder-modal__close" aria-label="關閉" onClick={onClose}>
          ×
        </button>
        <h2 id="reminder-modal-title" className="reminder-modal__title">簽到提醒</h2>

        {loading ? (
          <p className="reminder-modal__loading">載入中...</p>
        ) : (
          <div className="reminder-modal__content">
            <p className="reminder-modal__desc">
              開啟後，系統會在你設定的時間以 email 提醒你記帳或簽到，避免連續記帳天數中斷。
            </p>

            {/* Toggle */}
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
              {/* Timezone */}
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

              {/* Time — two WheelPickers side by side */}
              <div className="reminder-modal__field">
                <label className="reminder-modal__label">提醒時間</label>
                <div className="reminder-modal__time-wheels">
                  <WheelPicker
                    items={HOURS}
                    value={hour}
                    onChange={setHour}
                    disabled={!enabled}
                  />
                  <span className="reminder-modal__time-sep" aria-hidden="true">:</span>
                  <WheelPicker
                    items={MINUTES}
                    value={minute}
                    onChange={setMinute}
                    disabled={!enabled}
                  />
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
    </Modal>
  );
}
