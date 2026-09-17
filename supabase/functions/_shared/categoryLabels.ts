// @ts-nocheck
// 排程自動入帳時「未指定分類」的後備分類名稱，依使用者語言決定。
// 必須與前端兩處保持一致：
//   - src/hooks/useSubscriptions.js 建立當日扣款時的 t('transaction.other')
//   - src/hooks/useSettings.js 預設分類清單的最後一項（'其他' / 'Other'）
// 由 tests/unit/subscriptionCategoryFallback.test.js 對照 locales 鎖住。
import type { Lang } from './userLang.ts'

const OTHER_CATEGORY: Record<Lang, string> = { zh: '其他', en: 'Other' }

export function otherCategoryLabel(lang: Lang): string {
  return OTHER_CATEGORY[lang] ?? OTHER_CATEGORY.zh
}
