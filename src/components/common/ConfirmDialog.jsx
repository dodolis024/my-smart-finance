export default function ConfirmDialog({ state, onConfirm, onCancel }) {
  if (!state) return null;

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-dialog__message">{state.message}</div>
        <div className="confirm-dialog__actions">
          <button className="confirm-dialog__btn" onClick={onCancel}>
            取消
          </button>
          <button
            className={`confirm-dialog__btn ${state.danger ? 'confirm-dialog__btn--danger' : 'confirm-dialog__btn--confirm'}`}
            onClick={onConfirm}
          >
            確定
          </button>
        </div>
      </div>
    </div>
  );
}
