const MAX_CACHED_GROUPS = 15;
const expenseCache = {};   // { [groupId]: expenses[] }
const settlementCache = {}; // { [groupId]: settlements[] }

function evictCacheIfNeeded() {
  const keys = Object.keys(expenseCache);
  if (keys.length > MAX_CACHED_GROUPS) {
    const toRemove = keys.slice(0, keys.length - MAX_CACHED_GROUPS);
    toRemove.forEach(k => { delete expenseCache[k]; delete settlementCache[k]; });
  }
}

export function getCachedExpenses(groupId) {
  return expenseCache[groupId] ?? null;
}

export function getCachedSettlements(groupId) {
  return settlementCache[groupId] ?? null;
}

export function updateCache(groupId, expenses, settlements) {
  expenseCache[groupId] = expenses;
  settlementCache[groupId] = settlements;
  evictCacheIfNeeded();
}
