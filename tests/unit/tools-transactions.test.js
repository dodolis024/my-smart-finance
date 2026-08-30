import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * tools/core/transactions.js 是 src/hooks/useTransactions.js 寫入邏輯的第二份實作，
 * 這些測試就是在守住「兩邊算出來的結果必須一致」這條線。
 */

const mocks = vi.hoisted(() => ({
  queues: new Map(),
  rpcImpl: vi.fn(),
  writes: [],
  user: { id: 'user-1', email: 'test@example.com' },
}));

/** 取出寫進某張表的 payload，用來驗證真正送到資料庫的欄位值 */
function lastWrite(table, op) {
  return [...mocks.writes].reverse().find((w) => w.table === table && w.op === op)?.payload;
}

function queueResult(table, result) {
  if (!mocks.queues.has(table)) mocks.queues.set(table, []);
  mocks.queues.get(table).push(result);
}

function takeResult(table) {
  const queue = mocks.queues.get(table);
  if (!queue || queue.length === 0) return { data: null, error: null };
  return queue.length === 1 ? queue[0] : queue.shift();
}

/**
 * 鏈式 query builder：所有方法回傳自己，await 時才吐出預先排好的結果。
 * 寫入類的方法會把 payload 記下來，測試才驗得到真正送進資料庫的欄位值。
 */
function makeBuilder(table, result) {
  const builder = {};
  const readOnly = ['select', 'eq', 'in', 'order', 'limit', 'gte', 'lte', 'ilike', 'single', 'maybeSingle', 'delete'];
  for (const method of readOnly) builder[method] = () => builder;

  for (const op of ['insert', 'update', 'upsert']) {
    builder[op] = (payload) => {
      mocks.writes.push({ table, op, payload });
      return builder;
    };
  }

  builder.then = (resolve) => resolve(result);
  return builder;
}

vi.mock('../../tools/core/client.js', () => ({
  getAuthedClient: async () => ({
    from: (table) => makeBuilder(table, takeResult(table)),
    rpc: (...args) => mocks.rpcImpl(...args),
  }),
  getCurrentUser: async () => mocks.user,
}));

const { addTransaction, updateTransaction, deleteTransaction } = await import(
  '../../tools/core/transactions.js'
);

const CATEGORIES = [
  { key: 'expense_categories', value: ['飲食', '交通', '其他'] },
  { key: 'income_categories', value: ['薪水', '其他'] },
];
const ACCOUNTS = [{ id: 'acc-1', name: '現金', type: 'cash' }];

function setupHappyPath({ insertData = {}, checkinError = null } = {}) {
  queueResult('settings', { data: CATEGORIES, error: null });
  queueResult('accounts', { data: ACCOUNTS, error: null });
  queueResult('transactions', {
    data: { id: 'tx-1', item_name: '星巴克', ...insertData },
    error: null,
  });
  queueResult('checkins', { data: null, error: checkinError });
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

beforeEach(() => {
  mocks.queues.clear();
  mocks.writes.length = 0;
  mocks.rpcImpl.mockReset();
});

describe('addTransaction — 匯率與台幣換算', () => {
  it('TWD 使用匯率 1，不呼叫匯率 RPC，台幣金額等於原始金額', async () => {
    setupHappyPath();

    await addTransaction({ itemName: '星巴克', amount: 150, category: '飲食', account: '現金' });

    expect(mocks.rpcImpl).not.toHaveBeenCalled();
    expect(lastWrite('transactions', 'insert')).toMatchObject({
      currency: 'TWD',
      amount: 150,
      exchange_rate: 1.0,
      twd_amount: 150,
    });
  });

  it('非 TWD 依 RPC 匯率換算，且捨入到小數第二位', async () => {
    setupHappyPath();
    // 1200 * 0.21534 = 258.408，正確結果是 258.41；若捨入方式寫錯會變成 258.4 或 258
    mocks.rpcImpl.mockResolvedValue({ data: 0.21534, error: null });

    await addTransaction({
      itemName: '拉麵',
      amount: 1200,
      category: '飲食',
      account: '現金',
      currency: 'jpy',
    });

    expect(mocks.rpcImpl).toHaveBeenCalledWith('get_exchange_rate', { p_currency: 'JPY' });
    expect(lastWrite('transactions', 'insert')).toMatchObject({
      currency: 'JPY',
      amount: 1200,
      exchange_rate: 0.21534,
      twd_amount: 258.41,
    });
  });

  it('account_id 與 payment_method 兩個欄位都會寫入', async () => {
    setupHappyPath();

    await addTransaction({ itemName: '星巴克', amount: 150, category: '飲食', account: '現金' });

    expect(lastWrite('transactions', 'insert')).toMatchObject({
      account_id: 'acc-1',
      payment_method: '現金',
      user_id: 'user-1',
      type: 'expense',
      category: '飲食',
    });
  });

  it('查無匯率時整筆擋下，不會退回 1:1 記帳', async () => {
    queueResult('settings', { data: CATEGORIES, error: null });
    queueResult('accounts', { data: ACCOUNTS, error: null });
    mocks.rpcImpl.mockResolvedValue({ data: null, error: null });

    await expect(
      addTransaction({
        itemName: '不存在的幣別',
        amount: 100,
        category: '飲食',
        account: '現金',
        currency: 'XYZ',
      })
    ).rejects.toMatchObject({ code: 'RATE_UNAVAILABLE' });
  });

  it('匯率為 0 也視為查無匯率', async () => {
    queueResult('settings', { data: CATEGORIES, error: null });
    queueResult('accounts', { data: ACCOUNTS, error: null });
    mocks.rpcImpl.mockResolvedValue({ data: 0, error: null });

    await expect(
      addTransaction({ itemName: 'x', amount: 100, category: '飲食', account: '現金', currency: 'USD' })
    ).rejects.toMatchObject({ code: 'RATE_UNAVAILABLE' });
  });
});

describe('addTransaction — 簽到', () => {
  it('交易日期是今天時會簽到', async () => {
    setupHappyPath();

    const result = await addTransaction({
      itemName: '星巴克',
      amount: 150,
      category: '飲食',
      account: '現金',
      date: today(),
    });

    expect(result.checkedIn).toBe(true);
    expect(lastWrite('checkins', 'upsert')).toMatchObject({
      user_id: 'user-1',
      date: today(),
      source: 'onTimeTransaction',
    });
  });

  it('補記昨天的帳不算簽到', async () => {
    setupHappyPath();

    const result = await addTransaction({
      itemName: '昨天的咖啡',
      amount: 150,
      category: '飲食',
      account: '現金',
      date: 'yesterday',
    });

    expect(result.checkedIn).toBe(false);
    expect(lastWrite('checkins', 'upsert')).toBeUndefined();
  });

  it('簽到失敗不影響記帳成功', async () => {
    setupHappyPath({ checkinError: { message: 'checkin boom' } });

    const result = await addTransaction({
      itemName: '星巴克',
      amount: 150,
      category: '飲食',
      account: '現金',
      date: today(),
    });

    expect(result.transaction).toBeTruthy();
    expect(result.checkedIn).toBe(false);
  });
});

describe('addTransaction — 驗證', () => {
  it.each([
    ['零', 0],
    ['負數', -50],
    ['非數字', 'abc'],
    ['超過欄位上限', 100000000],
  ])('%s金額會被擋下', async (_label, amount) => {
    setupHappyPath();

    await expect(
      addTransaction({ itemName: 'x', amount, category: '飲食', account: '現金' })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('接受含千分位逗號的金額', async () => {
    setupHappyPath();

    const result = await addTransaction({
      itemName: '筆電',
      amount: '35,000',
      category: '飲食',
      account: '現金',
    });

    expect(result.transaction).toBeTruthy();
  });

  it('項目名稱空白會被擋下', async () => {
    await expect(
      addTransaction({ itemName: '   ', amount: 100, category: '飲食', account: '現金' })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('日期格式錯誤會被擋下', async () => {
    await expect(
      addTransaction({ itemName: 'x', amount: 100, category: '飲食', account: '現金', date: '8/30' })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('不存在的日期（2 月 31 日）會被擋下', async () => {
    await expect(
      addTransaction({
        itemName: 'x',
        amount: 100,
        category: '飲食',
        account: '現金',
        date: '2026-02-31',
      })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('addTransaction — 帳戶與分類解析', () => {
  it('帳戶名稱對不上時報錯，並在 hint 附上可用帳戶', async () => {
    queueResult('settings', { data: CATEGORIES, error: null });
    queueResult('accounts', { data: ACCOUNTS, error: null });

    await expect(
      addTransaction({ itemName: 'x', amount: 100, category: '飲食', account: '信用卡' })
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND', hint: expect.stringContaining('現金') });
  });

  it('分類不存在時報錯，並在 hint 附上可用分類', async () => {
    queueResult('settings', { data: CATEGORIES, error: null });

    await expect(
      addTransaction({ itemName: 'x', amount: 100, category: '寵物', account: '現金' })
    ).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND', hint: expect.stringContaining('飲食') });
  });

  it('分類同時是支出與收入時，未指定 type 會要求說清楚', async () => {
    queueResult('settings', { data: CATEGORIES, error: null });

    await expect(
      addTransaction({ itemName: 'x', amount: 100, category: '其他', account: '現金' })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', hint: expect.stringContaining('type') });
  });

  it('指定 type 後歧義分類可正常記帳', async () => {
    setupHappyPath();

    const result = await addTransaction({
      itemName: '獎金',
      amount: 5000,
      category: '其他',
      account: '現金',
      type: 'income',
    });

    expect(result.transaction).toBeTruthy();
  });
});

describe('updateTransaction — 歷史匯率', () => {
  const EXISTING = {
    id: 'tx-1',
    date: '2026-01-15',
    item_name: '拉麵',
    category: '飲食',
    type: 'expense',
    currency: 'JPY',
    amount: 1000,
    exchange_rate: 0.21,
    twd_amount: 210,
  };

  it('幣別未變時沿用原匯率，不重新查今日匯率', async () => {
    queueResult('transactions', { data: EXISTING, error: null });
    queueResult('transactions', { data: { ...EXISTING, amount: 2000, twd_amount: 420 }, error: null });

    await updateTransaction('tx-1', { amount: 2000 });

    expect(mocks.rpcImpl).not.toHaveBeenCalled();
    // 用原本的 0.21 而非今日匯率重算：2000 * 0.21 = 420
    expect(lastWrite('transactions', 'update')).toMatchObject({
      amount: 2000,
      exchange_rate: 0.21,
      twd_amount: 420,
    });
  });

  it('只改備註不會動到金額欄位，也不查匯率', async () => {
    queueResult('transactions', { data: EXISTING, error: null });
    queueResult('transactions', { data: { ...EXISTING, note: '好吃' }, error: null });

    await updateTransaction('tx-1', { note: '好吃' });

    expect(mocks.rpcImpl).not.toHaveBeenCalled();
  });

  it('幣別改變時才重新取匯率', async () => {
    queueResult('transactions', { data: EXISTING, error: null });
    queueResult('transactions', { data: { ...EXISTING, currency: 'USD' }, error: null });
    mocks.rpcImpl.mockResolvedValue({ data: 31.5, error: null });

    await updateTransaction('tx-1', { currency: 'USD' });

    expect(mocks.rpcImpl).toHaveBeenCalledWith('get_exchange_rate', { p_currency: 'USD' });
  });

  it('既有匯率是壞值時，即使只改備註也會重算修復（與網頁編輯行為一致）', async () => {
    queueResult('transactions', { data: { ...EXISTING, exchange_rate: 0, twd_amount: 0 }, error: null });
    queueResult('transactions', { data: EXISTING, error: null });
    mocks.rpcImpl.mockResolvedValue({ data: 0.22, error: null });

    await updateTransaction('tx-1', { note: '好吃' });

    expect(mocks.rpcImpl).toHaveBeenCalledWith('get_exchange_rate', { p_currency: 'JPY' });
    expect(lastWrite('transactions', 'update')).toMatchObject({
      exchange_rate: 0.22,
      twd_amount: 220,
    });
  });

  it('找不到 id 時報錯並提示先查詢', async () => {
    queueResult('transactions', { data: null, error: null });

    await expect(updateTransaction('nope', { amount: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('沒有任何欄位要改時報錯', async () => {
    queueResult('transactions', { data: EXISTING, error: null });

    await expect(updateTransaction('tx-1', {})).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('deleteTransaction', () => {
  it('回傳被刪除的內容，讓誤刪時還原得回來', async () => {
    const existing = { id: 'tx-1', item_name: '星巴克', amount: 150, category: '飲食' };
    queueResult('transactions', { data: existing, error: null });
    queueResult('transactions', { data: null, error: null });

    const result = await deleteTransaction('tx-1');

    expect(result.deleted).toMatchObject({ item_name: '星巴克', amount: 150 });
  });

  it('沒有 id 時報錯', async () => {
    await expect(deleteTransaction('')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
