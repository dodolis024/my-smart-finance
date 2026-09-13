import { useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';

export default function ConfirmDialog({ state, onConfirm, onCancel }) {
  const { t } = useLanguage();

  // 確認框常疊在其他 Modal 上（例如設定裡刪除類別）。Modal 在 document 監聽 Esc，
  // 若不先攔下，Esc 會關掉底下的 Modal、留下仍可按「確定」的確認框。
  // 在 window capture 階段處理並 stopPropagation，Esc 就只關最上層的確認框。
  useEffect(() => {
    if (!state) return;
    const handleKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onCancel();
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [state, onCancel]);

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
