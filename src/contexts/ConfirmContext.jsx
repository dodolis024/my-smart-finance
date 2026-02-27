import { createContext, useContext, useState, useCallback, useRef } from 'react';

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
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

  const value = { confirmState, confirm, handleConfirm, handleCancel };

  return <ConfirmContext.Provider value={value}>{children}</ConfirmContext.Provider>;
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  return context;
}
