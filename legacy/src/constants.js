/**
 * Constants - 集中管理魔術數字與 hard-coded 值
 */

// Layout breakpoints (px)
const LAYOUT = {
    VERTICAL_MAX_WIDTH: 870,  // 垂直顯示（寬度 ≤ 870px）時，單欄布局／streak 按鈕移到 top-bar
    MOBILE_MAX_WIDTH: 600,     // 手機版：日期顯示簡化為月-日
};

// Swipe 滑動操作
const SWIPE = {
    THRESHOLD: 50,      // 滑動閾值（超過此距離才觸發編輯/刪除）
    ACTION_WIDTH: 90,   // 操作按鈕寬度（編輯、刪除）
    MAX_LEFT: -90,      // 左滑最大距離
    MAX_RIGHT: 90,      // 右滑最大距離
};

// Streak 連續記帳里程碑天數
const STREAK_MILESTONES = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300];

//  Timing / 延遲 (ms)
const TIMING = {
    FOCUS_DELAY: 150,                    // 捲動後 focus 輸入欄的延遲
    FILTER_IGNORE_SCROLL_MS: 800,        // 篩選套用後忽略 scroll 關閉 popover 的時間
    FILTER_REPOSITION_AFTER_SCROLL_MS: 450,  // 篩選捲動後重新定位 popover 的延遲
    SWIPE_TRANSITION_DURATION: 300,      // 滑動復位動畫時長 (ms)
};

// Debounce 延遲 (ms)
const DEBOUNCE = {
    RESIZE_MS: 150,
    SCROLL_MS: 100,
};

// OAuth 新用戶預設帳戶
const DEFAULT_ACCOUNT = {
    CREDIT_LIMIT: 50000,
    BILLING_DAY: 5,
    PAYMENT_DUE_DAY: 25,
};
