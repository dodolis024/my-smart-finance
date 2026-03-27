import { useEffect, useState, useRef } from 'react';
import Modal from '@/components/common/Modal';
import { useScrollbarOnScroll } from '@/hooks/useScrollbarOnScroll';
import { useReminderSettings } from '@/hooks/useReminderSettings';
import { useToast } from '@/contexts/ToastContext';
import { WheelPicker, HOURS, MINUTES } from './wheelPicker/WheelPicker';
import { COMMON_TIMEZONES } from './data/commonTimezones';

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
                    itemHeight={40}
                    visibleCount={3}
                  />
                  <span className="reminder-modal__time-sep" aria-hidden="true">:</span>
                  <WheelPicker
                    items={MINUTES}
                    value={minute}
                    onChange={setMinute}
                    disabled={!enabled}
                    itemHeight={40}
                    visibleCount={3}
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
