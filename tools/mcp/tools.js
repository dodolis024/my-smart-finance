import { listAccounts } from '../core/accounts.js';
import { getCurrentUser } from '../core/client.js';
import { loginWithBrowser } from '../core/oauth.js';
import { listCategories } from '../core/categories.js';
import { getMonthlySummary, getStreak, getYearlyReview } from '../core/stats.js';
import {
  addTransaction,
  deleteTransaction,
  getTransaction,
  listTransactions,
  updateTransaction,
} from '../core/transactions.js';

// 登入要等使用者去瀏覽器點按鈕，但呼叫端多半有自己的逾時（常見是 2 分鐘），
// 所以這裡抓短一點，寧可回一個「請再試一次」也不要讓對方那邊直接斷線
const LOGIN_TIMEOUT_MS = 110 * 1000;

/**
 * MCP tool 定義。
 *
 * description 是寫給 agent 看的，不是寫給人看的：把「什麼時候該先呼叫哪個 tool」
 * 直接講明白，可以省掉很多次猜錯後的重試。
 */
export const TOOLS = [
  {
    name: 'login',
    description:
      '登入 My Smart Finance 帳號。會在使用者電腦上開啟瀏覽器的授權頁面，' +
      '請他用平常登入網站的同一個帳號完成授權。任何工具回報 NOT_AUTHENTICATED 時就呼叫這個。' +
      '呼叫前請先告訴使用者「瀏覽器即將跳出，請完成登入」，因為這個工具會等他操作完才回應。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const result = await loginWithBrowser({ timeoutMs: LOGIN_TIMEOUT_MS });
      return { loggedIn: true, ...result };
    },
  },
  {
    name: 'auth_status',
    description: '查看目前登入的是哪個帳號。尚未登入時會回報 NOT_AUTHENTICATED，此時請呼叫 login。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const user = await getCurrentUser();
      return { loggedIn: true, email: user.email, userId: user.id };
    },
  },
  {
    name: 'add_transaction',
    description:
      '記一筆帳（支出或收入）。分類與帳戶名稱必須與使用者現有的設定完全相符，' +
      '不確定時請先呼叫 list_categories 與 list_accounts 查詢，不要自己編造名稱。' +
      '非台幣的幣別會自動依系統匯率換算成台幣。',
    inputSchema: {
      type: 'object',
      properties: {
        itemName: { type: 'string', description: '項目名稱，例如「星巴克」' },
        amount: { type: 'number', description: '金額，必須大於 0（原始幣別的金額，不是台幣）' },
        category: { type: 'string', description: '分類名稱，必須是使用者已建立的分類' },
        account: { type: 'string', description: '付款方式／帳戶名稱，必須與現有帳戶完全相符' },
        type: {
          type: 'string',
          enum: ['expense', 'income'],
          description: '收支類型。分類同時存在於支出與收入清單時（例如「其他」）必填',
        },
        currency: { type: 'string', description: '幣別代碼，預設 TWD' },
        date: { type: 'string', description: 'YYYY-MM-DD，或 today / yesterday，預設今天' },
        time: { type: 'string', description: 'HH:MM 24 小時制，預設現在時間' },
        note: { type: 'string', description: '備註' },
      },
      required: ['itemName', 'amount', 'category', 'account'],
    },
    handler: addTransaction,
  },
  {
    name: 'list_transactions',
    description:
      '查詢交易紀錄。要修改或刪除某筆交易時，必須先用這個 tool 查出它的 id。',
    inputSchema: {
      type: 'object',
      properties: {
        month: { type: 'number', description: '月份 1-12，與 year 搭配使用' },
        year: { type: 'number', description: '年份，例如 2026' },
        from: { type: 'string', description: '起始日期 YYYY-MM-DD' },
        to: { type: 'string', description: '結束日期 YYYY-MM-DD' },
        type: { type: 'string', enum: ['expense', 'income'] },
        category: { type: 'string', description: '只看某個分類' },
        search: { type: 'string', description: '項目名稱關鍵字（模糊比對）' },
        limit: { type: 'number', description: '筆數上限，預設 20，最多 200' },
      },
    },
    handler: listTransactions,
  },
  {
    name: 'get_transaction',
    description: '用 id 讀取單筆交易的完整內容。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '交易 id（UUID）' } },
      required: ['id'],
    },
    handler: ({ id }) => getTransaction(id),
  },
  {
    name: 'update_transaction',
    description:
      '修改一筆已存在的交易，只需要提供想改的欄位。必須指定交易 id，' +
      '請先用 list_transactions 查到 id，並在修改前向使用者確認是哪一筆。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '交易 id（UUID）' },
        itemName: { type: 'string' },
        amount: { type: 'number' },
        category: { type: 'string' },
        type: { type: 'string', enum: ['expense', 'income'] },
        account: { type: 'string' },
        currency: { type: 'string' },
        date: { type: 'string' },
        time: { type: 'string' },
        note: { type: 'string' },
      },
      required: ['id'],
    },
    handler: ({ id, ...patch }) => updateTransaction(id, patch),
  },
  {
    name: 'delete_transaction',
    description:
      '刪除一筆交易，必須指定 id（不支援依條件批次刪除）。這是不可復原的操作，' +
      '請先用 list_transactions 查出 id，並向使用者確認要刪的是哪一筆之後再呼叫。' +
      '回傳內容會包含被刪除的交易明細。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '交易 id（UUID）' } },
      required: ['id'],
    },
    handler: ({ id }) => deleteTransaction(id),
  },
  {
    name: 'list_accounts',
    description: '列出使用者所有的帳戶／付款方式。記帳前若不確定帳戶名稱，先呼叫這個。',
    inputSchema: { type: 'object', properties: {} },
    handler: () => listAccounts(),
  },
  {
    name: 'list_categories',
    description:
      '列出可用的支出與收入分類。記帳前若不確定分類名稱，先呼叫這個。' +
      '分類無法透過這套工具新增，只能使用清單中已有的。',
    inputSchema: { type: 'object', properties: {} },
    handler: () => listCategories(),
  },
  {
    name: 'get_summary',
    description: '取得某個月份的收支總覽與分類排行，預設為本月。回答「這個月花了多少」用這個。',
    inputSchema: {
      type: 'object',
      properties: {
        year: { type: 'number' },
        month: { type: 'number', description: '1-12' },
      },
    },
    handler: getMonthlySummary,
  },
  {
    name: 'get_streak',
    description: '取得連續記帳天數、最長紀錄與累計記帳天數。',
    inputSchema: { type: 'object', properties: {} },
    handler: () => getStreak(),
  },
  {
    name: 'get_yearly_review',
    description: '取得年度回顧統計，包含年度總計、每月分佈、分類排行與前一年比較。',
    inputSchema: {
      type: 'object',
      properties: { year: { type: 'number', description: '年份，預設今年' } },
    },
    handler: ({ year } = {}) => getYearlyReview(year),
  },
];

export const TOOL_MAP = new Map(TOOLS.map((tool) => [tool.name, tool]));
