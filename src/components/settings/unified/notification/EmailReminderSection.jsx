import { useState, useEffect, useRef, useId, useCallback } from 'react';
import { WheelPicker, HOURS, MINUTES } from '../../wheelPicker/WheelPicker';
import { getCommonTimezones } from '../../data/commonTimezones';
import { useReminderSettings } from '@/hooks/useReminderSettings';
import { useLanguage } from '@/contexts/LanguageContext';
import DisclosureToggle from '../../DisclosureToggle';

const SAVE_DELAY_MS = 600;
const pad2 = (n) => String(n).padStart(2, '0');

// 簽到提醒信：設定寫入 settings 表的 reminder_settings，由 send-streak-reminder 寄出。
// 走 email，與推播無關——這一區不需要使用者開啟裝置推播。
// 即時儲存：開關立即存，時區與時間停止調整 600ms 後存；失敗才跳 toast 並還原成已存的值。
export default function EmailReminderSection({ isOpen, toast, open, onToggle, groupRef }) {
  const { t, lang } = useLanguage();
  const { reminderSettings, loading, loadReminderSettings, saveReminderSettings } = useReminderSettings();
  const [enabled, setEnabled] = useState(false);
  const [timezone, setTimezone] = useState('Asia/Taipei');
  const [hour, setHour] = useState(20);
  const [minute, setMinute] = useState(0);
  const bodyId = useId();
  const timezoneId = useId();
  const timerRef = useRef(null);
  const pendingRef = useRef(null);

  useEffect(() => {
    if (isOpen) loadReminderSettings();
  }, [isOpen, loadReminderSettings]);

  const resyncFromSaved = useCallback(() => {
    setEnabled(reminderSettings.enabled);
    setTimezone(reminderSettings.timezone);
    const [h, m] = (reminderSettings.time || '20:00').split(':').map(Number);
    setHour(h ?? 20);
    setMinute(Math.round((m ?? 0) / 5) * 5 % 60);
  }, [reminderSettings]);

  // 還有沒送出的變更時不覆寫，否則前一次存檔完成會把使用者剛調好的值蓋回去
  useEffect(() => {
    if (!pendingRef.current) resyncFromSaved();
  }, [resyncFromSaved]);

  const flush = async () => {
    clearTimeout(timerRef.current);
    const next = pendingRef.current;
    pendingRef.current = null;
    if (!next) return;
    try {
      await saveReminderSettings(next);
    } catch (err) {
      toast.error(err.message || t('common.saveFailed'));
      resyncFromSaved();
    }
  };
  // 計時器與卸載時的 cleanup 都透過 ref 呼叫，拿到的一定是最新一次 render 的 flush
  const flushRef = useRef(flush);
  useEffect(() => { flushRef.current = flush; });
  useEffect(() => () => { if (pendingRef.current) flushRef.current(); }, []); // 關視窗時把還沒存的存掉

  const persist = (patch, { immediate = false } = {}) => {
    const s = { enabled, timezone, hour, minute, ...patch };
    setEnabled(s.enabled);
    setTimezone(s.timezone);
    setHour(s.hour);
    setMinute(s.minute);
    pendingRef.current = { enabled: s.enabled, timezone: s.timezone, time: `${pad2(s.hour)}:${pad2(s.minute)}` };
    clearTimeout(timerRef.current);
    if (immediate) flushRef.current();
    else timerRef.current = setTimeout(() => flushRef.current(), SAVE_DELAY_MS);
  };

  const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const showDetectedHint = !loading && detectedTz && detectedTz !== timezone;
  const timezones = getCommonTimezones(lang);

  let status;
  if (loading) status = t('common.loadingDots');
  else if (enabled) status = t('settings.notification.reminderStatus', { time: `${pad2(hour)}:${pad2(minute)}` });
  else status = t('settings.notification.statusOff');

  const dimmed = !enabled ? ' settings-dimmed' : '';

  return (
    <div className="disclosure-group" ref={groupRef}>
      <div className="settings-list__row disclosure-row" onClick={onToggle}>
        <div className="settings-list__text">
          <span className="settings-list__label">{t('settings.notification.checkinReminder')}</span>
        </div>
        <div className="disclosure-right">
          <DisclosureToggle status={status} open={open} controls={bodyId} />
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={t('settings.notification.enableEmail')}
            className={`reminder-modal__toggle${enabled ? ' is-on' : ''}`}
            disabled={loading}
            onClick={(e) => { e.stopPropagation(); persist({ enabled: !enabled }, { immediate: true }); }}
          >
            <span className="reminder-modal__toggle-knob" />
          </button>
        </div>
      </div>
      {open && (
        <div id={bodyId}>
          {loading ? (
            <div className="settings-list__row settings-sub-row">
              <span className="settings-list__hint">{t('common.loadingDots')}</span>
            </div>
          ) : (
            <>
              <div className="settings-list__row settings-sub-row">
                <span className="settings-list__hint">{t('settings.notification.reminderDesc')}</span>
              </div>
              <div className={`settings-list__row settings-sub-row settings-sub-row--baseline${dimmed}`}>
                <div className="settings-list__text">
                  <label className="settings-list__label" htmlFor={timezoneId}>{t('settings.notification.timezone')}</label>
                </div>
                <div className="settings-sub-row__control">
                  <select
                    id={timezoneId}
                    className="reminder-modal__select"
                    value={timezone}
                    onChange={(e) => persist({ timezone: e.target.value })}
                    disabled={!enabled}
                  >
                    {timezones.map((tz) => (
                      <option key={tz.value} value={tz.value}>{tz.label}</option>
                    ))}
                  </select>
                  {showDetectedHint && (
                    <button
                      type="button"
                      className="reminder-modal__detect-btn"
                      onClick={() => persist({ timezone: detectedTz })}
                      disabled={!enabled}
                    >
                      {t('settings.notification.detectedTimezone', { tz: detectedTz })}
                    </button>
                  )}
                </div>
              </div>
              <div className={`settings-list__row settings-sub-row${dimmed}`}>
                <div className="settings-list__text">
                  <span className="settings-list__label">{t('settings.notification.reminderTime')}</span>
                </div>
                <div className="reminder-modal__time-wheels">
                  {/* 滾輪在程式捲動定位時也會觸發 onChange，值沒變就不存 */}
                  <WheelPicker items={HOURS} value={hour} onChange={(v) => { if (v !== hour) persist({ hour: v }); }} disabled={!enabled} />
                  <span className="reminder-modal__time-sep" aria-hidden="true">:</span>
                  <WheelPicker items={MINUTES} value={minute} onChange={(v) => { if (v !== minute) persist({ minute: v }); }} disabled={!enabled} />
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
