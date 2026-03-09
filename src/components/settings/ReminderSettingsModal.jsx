import { useEffect, useState, useRef } from 'react';
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
  const [time, setTime] = useState('20:00');

  useEffect(() => {
    if (isOpen) loadReminderSettings();
  }, [isOpen, loadReminderSettings]);

  useEffect(() => {
    setEnabled(reminderSettings.enabled);
    setTimezone(reminderSettings.timezone);
    setTime(reminderSettings.time);
  }, [reminderSettings]);

  const handleSave = async () => {
    try {
      await saveReminderSettings({ enabled, timezone, time });
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
      <div ref={dialogRef} className="reminder-modal__dialog scrollbar-on-scroll" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="reminder-modal__close" aria-label="關閉" onClick={onClose}>×</button>
        <h2 id="reminder-modal-title" className="reminder-modal__title">簽到提醒</h2>

        {loading ? (
          <p className="reminder-modal__loading">載入中...</p>
        ) : (
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
                <label className="reminder-modal__label" htmlFor="reminder-time">提醒時間</label>
                <input
                  id="reminder-time"
                  type="time"
                  className="reminder-modal__time-input"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  disabled={!enabled}
                />
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
