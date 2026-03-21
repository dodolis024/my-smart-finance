// 每次推出新版本時更新此版本號，未讀通知小點會自動出現
export const CURRENT_VERSION = '1.9.0';

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

export const CHART_COLORS = [
  'hsl(11, 36%, 60%)',
  'hsl(26, 36%, 60%)',
  'hsl(41, 36%, 60%)',
  'hsl(54, 36%, 58%)',
  'hsl(67, 36%, 60%)',
  'hsl(80, 36%, 60%)',
  'hsl(93, 36%, 60%)',
  'hsl(106, 36%, 60%)',
  'hsl(119, 36%, 60%)',
];

export const CHART_COLORS_ROSE = [
  'hsl(350, 56%, 63%)',
  'hsl(340, 46%, 74%)',
  'hsl(330, 56%, 63%)',
  'hsl(320, 46%, 74%)',
  'hsl(310, 56%, 63%)',
  'hsl(300, 46%, 74%)',
  'hsl(290, 56%, 63%)',
  'hsl(280, 46%, 74%)',
  'hsl(270, 56%, 63%)',
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

// Rose Quartz (#f7cac9) × Serenity (#92a8d1) — 晨曦主題圖表色，粉藍雙色系交替
// 晨曦：薰衣草紫為軸，向粉（Rose Quartz）與藍（Serenity）兩側延伸
export const CHART_COLORS_DAWN = [
  'hsl(240, 38%, 68%)',
  'hsl(350, 68%, 80%)',
  'hsl(260, 34%, 65%)',
  'hsl(330, 55%, 74%)',
  'hsl(220, 42%, 70%)',
  'hsl(280, 32%, 68%)',
  'hsl(355, 62%, 77%)',
  'hsl(210, 38%, 72%)',
  'hsl(300, 28%, 70%)',
];

export const MONTH_ABBREVS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const ACCOUNT_TYPE_NAMES = {
  cash: '現金',
  credit_card: '信用卡',
  debit_card: '金融卡',
  digital_wallet: '電子錢包',
  bank: '銀行帳戶',
};
