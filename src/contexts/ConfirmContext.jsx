import { createContext, useContext, useState, useCallback, useRef } from 'react';

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [confirmState, setConfirmState] = useState(null);
  const resolveRef = useRef(null);

  // href 有給的時候,確認鍵會渲染成真的 <a>:瀏覽器原生導航不會被彈出視窗
  // 阻擋器攔下來,await 之後才呼叫 window.open 就會有這個風險。
  const confirm = useCallback((message, { danger = false, href = null } = {}) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setConfirmState({ message, danger, href });
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
