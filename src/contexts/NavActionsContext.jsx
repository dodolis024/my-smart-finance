import { createContext, useContext, useRef, useState, useCallback } from 'react';

const NavActionsContext = createContext(null);

export function NavActionsProvider({ children }) {
  const actionsRef = useRef({});
  const [pendingAction, setPendingAction] = useState(null);

  const register = useCallback((name, fn) => {
    actionsRef.current[name] = fn;
  }, []);

  const unregister = useCallback((name) => {
    delete actionsRef.current[name];
  }, []);

  const dispatch = useCallback((name) => {
    const fn = actionsRef.current[name];
    if (fn) {
      fn();
    } else {
      setPendingAction(name);
    }
  }, []);

  const consumePending = useCallback(() => {
    const action = pendingAction;
    setPendingAction(null);
    return action;
  }, [pendingAction]);

  return (
    <NavActionsContext.Provider value={{ register, unregister, dispatch, consumePending, pendingAction }}>
      {children}
    </NavActionsContext.Provider>
  );
}

export function useNavActions() {
  return useContext(NavActionsContext);
}
