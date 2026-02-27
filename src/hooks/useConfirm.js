import { useState, useCallback, useRef } from 'react';

export function useConfirm() {
  const [confirmState, setConfirmState] = useState(null);
  const resolveRef = useRef(null);

  const confirm = useCallback((message, { danger = false } = {}) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setConfirmState({ message, danger });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    resolveRef.current?.(true);
    setConfirmState(null);
  }, []);

  const handleCancel = useCallback(() => {
    resolveRef.current?.(false);
    setConfirmState(null);
  }, []);

  return { confirmState, confirm, handleConfirm, handleCancel };
}
