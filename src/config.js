/**
 * Smart Expense Tracker - Supabase 配置
 */

// ⚠️ 請將以下兩個變數替換為你的 Supabase 專案資訊
// 你可以在 Supabase Dashboard > Settings > API 中找到這些資訊
const SUPABASE_URL = 'https://rlahfuzsxfbocmkecqvg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_wjxnEBkzCyZff_0ldN2_ag_jwyUaeF5';

// 初始化 Supabase Client（確保 Supabase 已載入）
// 使用 window 物件避免變數衝突，確保只初始化一次
(function() {
    if (typeof window.supabase === 'undefined') {
        console.error('Supabase 尚未載入，請確認 script 載入順序');
        return;
    }

    // 初始化 supabase client（如果尚未初始化）
    if (!window.supabaseClient) {
        window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
})();

/**
 * 取得 supabase client 的輔助函數
 */
function getSupabase() {
    if (!window.supabaseClient && typeof window.supabase !== 'undefined') {
        window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return window.supabaseClient;
}
