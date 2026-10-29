import { useState, useEffect } from 'react';
import Modal from '@/components/common/Modal';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * 建立或編輯旅程：名稱＋起訖日期。從系統提示開的會先帶好日期，並提醒可以自己調整。
 * form：{ mode: 'create' | 'edit', name, start, end, fromSuggestion }；null 表示關閉。
 */
export default function TripFormModal({ form, onClose, onSave }) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!form) return;
    setName(form.name || '');
    setStart(form.start || '');
    setEnd(form.end || '');
    setError('');
    setSaving(false);
  }, [form]);

  if (!form) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setError(t('spendingAnalysis.tripForm.nameRequired'));
    if (!start || !end) return setError(t('spendingAnalysis.tripForm.dateRequired'));
    if (end < start) return setError(t('spendingAnalysis.tripForm.dateOrder'));
    setSaving(true);
    try {
      await onSave({ name, start, end });
    } catch {
      setError(t('spendingAnalysis.tripForm.saveFailed'));
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={!!form} onClose={onClose} className="category-detail-modal" titleId="trip-form-title">
      <div className="category-detail-modal__backdrop" onClick={onClose} />
      <form className="category-detail-modal__dialog analysis-trip-form" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <button type="button" className="category-detail-modal__close" aria-label={t('common.close')} onClick={onClose}>×</button>
        <h2 id="trip-form-title" className="category-detail-modal__title">
          {t(form.mode === 'edit' ? 'spendingAnalysis.tripForm.editTitle' : 'spendingAnalysis.tripForm.createTitle')}
        </h2>

        <label className="analysis-field">
          <span className="analysis-field__label">{t('spendingAnalysis.tripForm.name')}</span>
          <input
            className="analysis-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('spendingAnalysis.tripForm.namePlaceholder')}
            maxLength={40}
            autoFocus
          />
        </label>
        <div className="analysis-trip-form__dates">
          <label className="analysis-field">
            <span className="analysis-field__label">{t('spendingAnalysis.tripForm.start')}</span>
            <input className="analysis-input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="analysis-field">
            <span className="analysis-field__label">{t('spendingAnalysis.tripForm.end')}</span>
            <input className="analysis-input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        {form.fromSuggestion && <p className="analysis-trip-form__note">{t('spendingAnalysis.tripForm.suggestedHint')}</p>}
        {error && <p className="analysis-trip-form__error" role="alert">{error}</p>}

        <div className="analysis-trip-form__actions">
          <button type="button" className="analysis-btn analysis-btn--quiet" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="analysis-btn analysis-btn--primary" disabled={saving}>
            {t(form.mode === 'edit' ? 'spendingAnalysis.tripForm.save' : 'spendingAnalysis.tripForm.create')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
