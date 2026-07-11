// @ts-nocheck
// 批次查詢使用者語言偏好（settings key='ui_preferences' 的 value.lang）。
// 查無列或非 'en' 一律回 'zh'（與前端 fallback 行為一致）。
// supabase 參數為呼叫端已建立的 service-role client（不受 RLS 限制）。
export type Lang = 'zh' | 'en'

export function normalizeLang(value: unknown): Lang {
  return (value as { lang?: string } | null)?.lang === 'en' ? 'en' : 'zh'
}

export async function getUserLangs(
  supabase: { from: (t: string) => any },
  userIds: string[]
): Promise<Map<string, Lang>> {
  const map = new Map<string, Lang>()
  if (userIds.length === 0) return map
  const { data, error } = await supabase
    .from('settings')
    .select('user_id, value')
    .eq('key', 'ui_preferences')
    .in('user_id', [...new Set(userIds)])
  if (error) {
    // 查詢失敗：全部 fallback 'zh'（通知屬加值功能，不因語言查詢失敗而中斷）
    console.error('[userLang] failed to fetch ui_preferences:', error.message)
    return map
  }
  for (const row of data || []) map.set(row.user_id, normalizeLang(row.value))
  return map
}
