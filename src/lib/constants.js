export const LAYOUT = {
  VERTICAL_MAX_WIDTH: 870,
  MOBILE_MAX_WIDTH: 600,
};

export const SWIPE = {
  THRESHOLD: 50,
  ACTION_WIDTH: 90,
  MAX_LEFT: -90,
  MAX_RIGHT: 90,
};

// 密碼長度下限。Supabase 後端的下限另設在 Dashboard → Authentication → Policies，
// 這裡只擋 UI 這條路徑，兩邊要一起調才算數。
export const MIN_PASSWORD_LENGTH = 8;

export const STREAK_MILESTONES = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300];

export const TIMING = {
  FOCUS_DELAY: 150,
  FILTER_IGNORE_SCROLL_MS: 800,
  FILTER_REPOSITION_AFTER_SCROLL_MS: 450,
  SWIPE_TRANSITION_DURATION: 300,
};

export const DEBOUNCE = {
  RESIZE_MS: 150,
  SCROLL_MS: 100,
};

export const DEFAULT_ACCOUNT = {
  CREDIT_LIMIT: 50000,
  BILLING_DAY: 5,
  PAYMENT_DUE_DAY: 25,
};

// Currencies with no minor unit — displayed as whole numbers, no decimal point.
// Based on the standard ISO 4217 zero-decimal list, plus TWD by this app's own
// convention (Taiwan practice treats NT$ as whole dollars despite ISO allowing 2).
// database/split-sync-migration.sql (get_split_sync_status) keeps a SQL copy of
// this list for v_decimal_places — keep both in sync when changing this set.
// sync_split_to_ledger no longer needs it: since the per-expense migration it
// writes each expense in its own currency instead of converting to the group's.
// Any one-off script that re-declares get_split_sync_status must carry the list
// over too: scripts/fix-split-sync-ownership.sql copied an older definition and
// silently reverted it (fixed by scripts/fix-split-sync-decimal-regression.sql).
export const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW',
  'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
  'TWD',
]);

// 奶茶（預設）主題圖表色：純奶茶色相（30°～38°），主要靠深淺區分；
// 深、中、淺平均分給前幾名（常見期間只有 5～6 個分類，前段不能擠在同一段明度）。
// 淺色端再亮就會貼近白色卡片，第 4、6 名改用「灰奶茶／奶油奶茶」的冷暖差拉開
export const CHART_COLORS = [
  'hsl(32, 28%, 64%)',
  'hsl(30, 26%, 34%)',
  'hsl(32, 28%, 56%)',
  'hsl(30, 22%, 76%)',
  'hsl(31, 27%, 45%)',
  'hsl(38, 44%, 83%)',
  'hsl(31, 27%, 50%)',
  'hsl(33, 29%, 71%)',
  'hsl(30, 26%, 40%)',
];

// Rose 主題圖表色：乾燥玫瑰（色相 340°～0°，不往紫色走），第 1 名是主色；
// 排列成波浪：莓果玫瑰由淺到深、再換紅玫瑰，色相只轉一次、深淺不大起大落；
// 圓餅圖第 9 名會貼回第 1 名，所以最後一色收在中明度，不讓最淺色硬接主色
export const CHART_COLORS_ROSE = [
  'hsl(350, 43%, 57%)',
  'hsl(342, 44%, 72%)',
  'hsl(340, 48%, 84%)',
  'hsl(340, 48%, 64%)',
  'hsl(340, 36%, 48%)',
  'hsl(358, 36%, 48%)',
  'hsl(0, 50%, 80%)',
  'hsl(0, 36%, 86%)',
  'hsl(0, 44%, 66%)',
];

export const CHART_COLORS_GRAY = [
  'hsl(200, 12%, 40%)',
  'hsl(200, 20%, 67%)',
  'hsl(210, 10%, 52%)',
  'hsl(190, 16%, 58%)',
  'hsl(215, 16%, 45%)',
  'hsl(200, 24%, 76%)',
  'hsl(205, 12%, 35%)',
  'hsl(195, 18%, 62%)',
  'hsl(210, 8%, 56%)',
];

// 晨曦主題圖表色：Serenity 藍 (#92a8d1) × Rose Quartz 粉 (#f7cac9) 一路漸層繞一圈
// （OKLCh 內插）：藍 → 較深的藕紫 → 粉 → 淡粉紫 → 淡藍。圓餅圖第 9 名會貼回第 1 名，
// 回程走另一條較淺的路回到藍，交接處才不會是淺粉硬撞藍；不要摻入兩色以外的色相
export const CHART_COLORS_DAWN = [
  'hsl(219, 41%, 70%)',
  'hsl(250, 29%, 68%)',
  'hsl(290, 22%, 62%)',
  'hsl(331, 39%, 72%)',
  'hsl(351, 61%, 81%)',
  'hsl(358, 69%, 86%)',
  'hsl(342, 60%, 87%)',
  'hsl(293, 34%, 84%)',
  'hsl(253, 39%, 83%)',
];

// Soda 主題圖表色：汽水藍＋薄荷（色相 176°～206°），整體偏淺走清爽路線；
// 名次順序讓色相「藍→薄荷→藍」漸變，不要藍綠一格一格交錯。
// 中深色不要用偏草綠的薄荷（又深又濃會跳出來），改用往藍側挪的湖水青
export const CHART_COLORS_SODA = [
  'hsl(199, 58%, 51%)',
  'hsl(184, 64%, 67%)',
  'hsl(184, 44%, 50%)',
  'hsl(176, 64%, 83%)',
  'hsl(193, 64%, 61%)',
  'hsl(204, 52%, 77%)',
  'hsl(206, 56%, 49%)',
  'hsl(204, 64%, 67%)',
  'hsl(196, 58%, 77%)',
];

// Sorbet 主題圖表色：橘黃藍三色系；同色系的兩個色（橘、橘黃、藍）用明度拉開一深一淺
export const CHART_COLORS_SORBET = [
  'hsl(28, 82%, 58%)',
  'hsl(42, 86%, 58%)',
  'hsl(198, 58%, 53%)',
  'hsl(20, 72%, 68%)',
  'hsl(36, 78%, 53%)',
  'hsl(195, 50%, 67%)',
  'hsl(32, 75%, 72%)',
  'hsl(45, 80%, 62%)',
  'hsl(200, 55%, 46%)',
];

// Peach 主題圖表色：純蜜桃粉彩（色相 2°～12°，不用偏杏黃的色）；
// 柔和靠「高飽和＋偏淺」而非降飽和，低飽和＋中明度會混出灰調
export const CHART_COLORS_PEACH = [
  'hsl(10, 75%, 68%)',
  'hsl(12, 64%, 86%)',
  'hsl(2, 74%, 80%)',
  'hsl(12, 88%, 76%)',
  'hsl(2, 88%, 76%)',
  'hsl(12, 80%, 82%)',
  'hsl(2, 66%, 68%)',
  'hsl(8, 64%, 72%)',
  'hsl(2, 72%, 86%)',
];

// Lime 主題圖表色：萊姆為軸，往奶油黃與葉綠／森林綠延伸（色相 48°～130°），深淺交錯
export const CHART_COLORS_LIME = [
  'hsl(72, 62%, 46%)',
  'hsl(48, 70%, 68%)',
  'hsl(105, 40%, 48%)',
  'hsl(60, 55%, 78%)',
  'hsl(88, 50%, 36%)',
  'hsl(130, 30%, 68%)',
  'hsl(52, 60%, 50%)',
  'hsl(95, 45%, 74%)',
  'hsl(115, 32%, 34%)',
];

// Lavender 主題圖表色：主色薰衣草＋淡粉紫（色相 252°～286°，只往紅紫側、不往藍），
// 飽和度壓低保持柔和；深色也要低彩度，又濃又深的紫看起來會像藍墨水
export const CHART_COLORS_LAVENDER = [
  'hsl(252, 33%, 62%)',
  'hsl(286, 24%, 82%)',
  'hsl(280, 26%, 44%)',
  'hsl(284, 32%, 70%)',
  'hsl(260, 24%, 52%)',
  'hsl(252, 26%, 74%)',
  'hsl(286, 28%, 60%)',
  'hsl(252, 36%, 70%)',
  'hsl(286, 36%, 54%)',
];

// Maple 主題圖表色：楓紅＋杏／奶茶暖色系（色相 3°～26°，不用冷粉；淺色偏杏、深色偏紅）
export const CHART_COLORS_MAPLE = [
  'hsl(5, 48%, 47%)',
  'hsl(14, 44%, 67%)',
  'hsl(10, 52%, 55%)',
  'hsl(26, 44%, 80%)',
  'hsl(3, 44%, 39%)',
  'hsl(26, 44%, 54%)',
  'hsl(14, 40%, 45%)',
  'hsl(26, 44%, 71%)',
  'hsl(3, 40%, 35%)',
];

export const MONTH_ABBREVS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
