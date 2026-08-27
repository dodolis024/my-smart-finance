// @ts-nocheck
// pg_cron 專用的共用密鑰驗證。
// 這幾支函式只由排程觸發，但 verify_jwt 對它們沒有防護力：cron 帶的 publishable key
// 同樣寫在前端 bundle 內，人人可得。改以 CRON_SECRET（Supabase secrets，不進 git、
// 不進前端）比對請求的 x-cron-secret header。
// 密鑰未設定時一律回 401（fail closed）——排程會停擺，但不會靜靜地敞著門。
export function cronSecretGuard(
  req: Request,
  corsHeaders: Record<string, string>
): Response | null {
  const cronSecret = Deno.env.get('CRON_SECRET')

  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response(
      JSON.stringify({ success: false, error: 'unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return null
}
