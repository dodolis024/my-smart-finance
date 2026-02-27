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

export const MONTH_ABBREVS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const ACCOUNT_TYPE_NAMES = {
  cash: '現金',
  credit_card: '信用卡',
  debit_card: '金融卡',
  digital_wallet: '電子錢包',
  bank: '銀行帳戶',
};
