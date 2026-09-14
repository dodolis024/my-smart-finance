import { createContext, useContext, useEffect, useMemo } from 'react';
import { useDisplayPreferences, DEFAULT_DISPLAY_PREFERENCES } from '@/hooks/useDisplayPreferences';
import { useDisplayRates } from '@/hooks/useDisplayRates';
import { buildDisplayAmount } from '@/lib/displayCurrency';

// 主畫面金額要用哪個幣別、每筆交易要不要改顯示原幣，集中在這裡決定。
// 由 DashboardPage 以使用者的顯示偏好提供；Provider 以外的地方拿到預設值（台幣），
// 行為與加入這個功能之前完全相同。
const DisplayAmountContext = createContext({ preferences: DEFAULT_DISPLAY_PREFERENCES, rateTable: null });

export function DisplayAmountProvider({ children }) {
  const { displayPreferences, loadDisplayPreferences } = useDisplayPreferences();
  const rateTable = useDisplayRates(displayPreferences.currency);

  // 換帳號時 load 的識別會跟著變，自動重抓那位使用者的偏好
  useEffect(() => {
    loadDisplayPreferences().catch(() => {});
  }, [loadDisplayPreferences]);

  const value = useMemo(() => ({ preferences: displayPreferences, rateTable }), [displayPreferences, rateTable]);
  return <DisplayAmountContext.Provider value={value}>{children}</DisplayAmountContext.Provider>;
}

/**
 * 區塊內的加總與額度本來就是台幣（信用卡額度、帳戶餘額），清單也要跟著用台幣，
 * 否則同一個彈窗裡上面是台幣、下面是英鎊。「原幣」模式不受影響。
 */
export function DisplayAmountTwdScope({ children }) {
  const parent = useContext(DisplayAmountContext);
  const value = useMemo(
    () => ({ preferences: { ...parent.preferences, currency: 'TWD' }, rateTable: null }),
    [parent.preferences]
  );
  return <DisplayAmountContext.Provider value={value}>{children}</DisplayAmountContext.Provider>;
}

export function useDisplayAmount() {
  const { preferences, rateTable } = useContext(DisplayAmountContext);
  return useMemo(() => buildDisplayAmount(preferences, rateTable), [preferences, rateTable]);
}
