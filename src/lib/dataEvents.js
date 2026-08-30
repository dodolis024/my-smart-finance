// 伺服器資料變更的跨元件通知：設定面板等「儀表板以外」的入口寫入資料後
// （新增訂閱的當日扣款、改動帳戶額度、類別改名連帶改寫舊交易…），
// 通知已掛載的儀表板靜默重抓當月資料，
// 否則儀表板不會卸載重掛，使用者要手動刷新才看得到變動。
// 與 offlineQueue 的 subscribeQueue、useDashboard 的 defaultCurrencyListeners 同一模式。

const listeners = new Set();

export function subscribeDataChanged(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyDataChanged() {
  listeners.forEach((l) => l());
}
