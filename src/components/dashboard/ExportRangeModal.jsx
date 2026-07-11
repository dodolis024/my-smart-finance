import { useEffect, useState } from 'react';
import Modal from '@/components/common/Modal';
import MonthPicker from './MonthPicker';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * 自訂月份區間匯出的選月彈窗。只負責選起始月/結束月並把結果丟回 onExport，
 * 不做 fetch 也不組 CSV（交由 DashboardPage 的 exportRange 處理）。
 * 沿用 split 系列 modal 的結構 class（split-modal / split-modal__dialog 等），
 * 與 CreateGroupModal、GroupSettingsModal 同一套視覺。
 */
export default function ExportRangeModal({ isOpen, onClose, initialYear, initialMonth, onExport }) {
  const { t } = useLanguage();
  const [startYear, setStartYear] = useState(initialYear);
  const [startMonth, setStartMonth] = useState(initialMonth);
  const [endYear, setEndYear] = useState(initialYear);
  const [endMonth, setEndMonth] = useState(initialMonth);

  // 每次打開都回到目前檢視的月份，避免殘留上次選擇
  useEffect(() => {
    if (isOpen) {
      setStartYear(initialYear);
      setStartMonth(initialMonth);
      setEndYear(initialYear);
      setEndMonth(initialMonth);
    }
  }, [isOpen, initialYear, initialMonth]);

  const handleExport = () => {
    onExport({ year: startYear, month: startMonth }, { year: endYear, month: endMonth });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="split-modal" titleId="export-range-title">
      <div className="reminder-modal__backdrop" onClick={onClose} />
      <div className="split-modal__dialog" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="reminder-modal__close" aria-label={t('common.close')} onClick={onClose}>×</button>
        <h2 id="export-range-title" className="split-modal__title">{t('dashboard.exportRangeTitle')}</h2>

        <div className="split-modal__field">
          <label className="split-modal__label">{t('dashboard.exportRangeStart')}</label>
          <MonthPicker
            year={startYear}
            month={startMonth}
            onChange={(y, m) => { setStartYear(y); setStartMonth(m); }}
          />
        </div>

        <div className="split-modal__field">
          <label className="split-modal__label">{t('dashboard.exportRangeEnd')}</label>
          <MonthPicker
            year={endYear}
            month={endMonth}
            onChange={(y, m) => { setEndYear(y); setEndMonth(m); }}
          />
        </div>

        <div className="split-modal__actions">
          <button type="button" className="split-btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="split-btn-primary" onClick={handleExport}>
            {t('dashboard.exportRangeSubmit')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
