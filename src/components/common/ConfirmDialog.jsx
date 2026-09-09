import { useLanguage } from '@/contexts/LanguageContext';

export default function ConfirmDialog({ state, onConfirm, onCancel }) {
  const { t } = useLanguage();
  if (!state) return null;

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-dialog__message">{state.message}</div>
        <div className="confirm-dialog__actions">
          <button className="confirm-dialog__btn" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          {state.href ? (
            <a
              className="confirm-dialog__btn confirm-dialog__btn--confirm"
              href={state.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onConfirm}
            >
              {t('common.confirm')}
            </a>
          ) : (
            <button
              className={`confirm-dialog__btn ${state.danger ? 'confirm-dialog__btn--danger' : 'confirm-dialog__btn--confirm'}`}
              onClick={onConfirm}
            >
              {t('common.confirm')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
