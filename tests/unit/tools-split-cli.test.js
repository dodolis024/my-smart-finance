import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * 分帳 CLI 的輸出契約。
 *
 * 守三件會讓 agent 出錯的事：--json 要是乾淨 JSON 且 id 不截短、
 * --dry-run 絕對不能寫入、旗標打錯要被擋下而不是默默算成全體均分。
 */

const GROUP = {
  id: 'group-1',
  name: '日本行',
  currency: 'TWD',
  default_expense_currency: null,
  archived_at: null,
  split_members: [
    { id: 'm1', name: 'Doris', user_id: 'user-doris' },
    { id: 'm2', name: '小明', user_id: null },
    { id: 'm3', name: '小美', user_id: null },
  ],
};

const EXPENSE = {
  id: 'a3f9c21b-1111-2222-3333-444455556666',
  group_id: GROUP.id,
  paid_by: 'm1',
  title: '吃飯',
  amount: 3000,
  currency: 'TWD',
  date: '2026-09-03',
  note: null,
  split_expense_shares: [
    { id: 's1', member_id: 'm1', share: 1000 },
    { id: 's2', member_id: 'm2', share: 1000 },
    { id: 's3', member_id: 'm3', share: 1000 },
  ],
};

vi.mock('../../tools/core/client.js', () => ({
  getAuthedClient: async () => ({}),
  getCurrentUser: async () => ({ id: 'user-doris' }),
}));

vi.mock('../../tools/core/splitGroups.js', async () => {
  const { ErrorCode, smfError } = await import('../../tools/core/errors.js');
  const findMember = (group, name) => {
    const match = (group.split_members || []).find((m) => m.name === name);
    if (match) return match;
    if (['me', '我', '自己'].includes(String(name).toLowerCase())) {
      return group.split_members.find((m) => m.user_id === 'user-doris');
    }
    throw smfError(ErrorCode.MEMBER_NOT_FOUND, `找不到成員「${name}」`, '成員：Doris、小明、小美');
  };
  return {
    listGroups: async () => [GROUP],
    resolveGroup: async (name) => {
      if (name && name !== GROUP.name) {
        throw smfError(ErrorCode.GROUP_NOT_FOUND, `找不到名稱為「${name}」的分帳群組`, '你的群組：日本行');
      }
      return GROUP;
    },
    getGroupById: async () => GROUP,
    resolveMember: async (group, name) => findMember(group, name),
    resolveSelf: async (group) => group.split_members.find((m) => m.user_id === 'user-doris'),
    memberNameList: (group) => group.split_members.map((m) => m.name).join('、'),
    assertNotArchived: () => {},
  };
});

const splitExpenses = {
  getGroupReport: vi.fn(async () => ({
    group: GROUP,
    expenses: [EXPENSE],
    expenseCount: 25,
    settlements: [],
    memberTotals: { m1: 1000, m2: 1000, m3: 1000 },
    settlement: [{ fromId: 'm2', toId: 'm1', from: '小明', to: 'Doris', amount: 1000 }],
    rates: { TWD: 1 },
  })),
  getExpense: vi.fn(async () => EXPENSE),
  addExpense: vi.fn(async () => ({ expense: EXPENSE, checkedIn: true })),
  updateExpense: vi.fn(async () => ({ ...EXPENSE, amount: 3600 })),
  deleteExpense: vi.fn(async () => ({ deleted: EXPENSE })),
  addSettlement: vi.fn(async () => ({ settlement: { id: 'set-1', amount: 500 } })),
};

vi.mock('../../tools/core/splitExpenses.js', () => splitExpenses);

const { splitCommand } = await import('../../tools/cli/commands/split.js');

let output;
let errorOutput;
let logSpy;
let errorSpy;

beforeEach(() => {
  output = [];
  errorOutput = [];
  process.exitCode = undefined;
  Object.values(splitExpenses).forEach((fn) => fn.mockClear());
  logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => output.push(args.join(' ')));
  errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => errorOutput.push(args.join(' ')));
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  process.exitCode = undefined;
});

function parsed() {
  return JSON.parse(output.join('\n'));
}

describe('--json 輸出', () => {
  it('show 是乾淨 JSON，費用 id 為完整 UUID', async () => {
    await splitCommand({ positional: ['show', '日本行'], flags: { json: true } });

    const data = parsed();
    expect(data.expenses[0].id).toBe(EXPENSE.id);
    expect(data.group.name).toBe('日本行');
    expect(data.member_totals).toEqual([
      { member_id: 'm1', name: 'Doris', total: 1000 },
      { member_id: 'm2', name: '小明', total: 1000 },
      { member_id: 'm3', name: '小美', total: 1000 },
    ]);
  });

  it('add 回傳費用本身、分攤明細與是否簽到', async () => {
    await splitCommand({
      positional: ['add', '吃飯', '3000'],
      flags: { json: true, group: '日本行', split: '我,小明,小美' },
    });

    const data = parsed();
    expect(data.expense.id).toBe(EXPENSE.id);
    expect(data.checkedIn).toBe(true);
    expect(data.shares).toEqual([
      { member_id: 'm1', name: 'Doris', share: 1000 },
      { member_id: 'm2', name: '小明', share: 1000 },
      { member_id: 'm3', name: '小美', share: 1000 },
    ]);
  });

  it('錯誤在 --json 模式下也是 JSON，印到 stderr 且 exit code 為 1', async () => {
    await splitCommand({ positional: ['show', '不存在的群組'], flags: { json: true } });

    expect(output).toHaveLength(0);
    const error = JSON.parse(errorOutput.join('\n'));
    expect(error.error).toBe('GROUP_NOT_FOUND');
    expect(error.message).toContain('不存在的群組');
    expect(error.hint).toContain('日本行');
    expect(process.exitCode).toBe(1);
  });
});

describe('--dry-run', () => {
  it('不呼叫任何寫入函式，且輸出標明尚未寫入', async () => {
    await splitCommand({
      positional: ['add', '吃飯', '3000'],
      flags: { group: '日本行', split: '我,小明,小美', 'dry-run': true },
    });

    expect(splitExpenses.addExpense).not.toHaveBeenCalled();
    const text = output.join('\n');
    expect(text).toContain('尚未寫入');
    expect(text).toContain('Doris NT$1,000');
  });

  it('--json 模式下帶 dryRun 旗標，並算出實際會寫入的分攤', async () => {
    await splitCommand({
      positional: ['add', '吃飯', '1000'],
      flags: { json: true, group: '日本行', 'dry-run': true },
    });

    const data = parsed();
    expect(data.dryRun).toBe(true);
    expect(splitExpenses.addExpense).not.toHaveBeenCalled();
    // 零頭給成員順序中的第一位
    expect(data.shares[0].share).toBeCloseTo(333.34, 10);
    expect(data.shares[1].share).toBeCloseTo(333.33, 10);
  });

  it('edit 的 dry-run 印出之前與之後，且不呼叫更新', async () => {
    await splitCommand({ positional: ['edit', 'a3f9c21b'], flags: { amount: '3600', 'dry-run': true } });

    expect(splitExpenses.updateExpense).not.toHaveBeenCalled();
    const text = output.join('\n');
    expect(text).toContain('之前：');
    expect(text).toContain('之後：');
    expect(text).toContain('NT$1,200');
  });
});

describe('參數防呆', () => {
  it('打錯旗標會被擋下並列出可用參數，不會靜默全體均分', async () => {
    await expect(
      splitCommand({ positional: ['add', '吃飯', '3000'], flags: { splt: '我,小明' } })
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('--splt'),
      hint: expect.stringContaining('--split'),
    });

    expect(splitExpenses.addExpense).not.toHaveBeenCalled();
  });

  it('--split 後面漏了值不會被當成「沒指定」', async () => {
    await expect(
      splitCommand({ positional: ['add', '吃飯', '3000'], flags: { split: true } })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('--split') });

    expect(splitExpenses.addExpense).not.toHaveBeenCalled();
  });

  it('settle 缺參數會報錯並說明正確寫法', async () => {
    await expect(
      splitCommand({ positional: ['settle'], flags: { from: '小明', amount: '500' } })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', hint: expect.stringContaining('--to') });
  });

  it('settle 的 from 與 to 相同要報錯', async () => {
    await expect(
      splitCommand({ positional: ['settle'], flags: { from: '小明', to: '小明', amount: '500' } })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    expect(splitExpenses.addSettlement).not.toHaveBeenCalled();
  });

  it('不認識的子命令會列出可用子命令', async () => {
    await expect(splitCommand({ positional: ['showw'], flags: {} })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      hint: expect.stringContaining('groups'),
    });
  });

  it('不帶子命令時印分帳 help', async () => {
    await splitCommand({ positional: [], flags: {} });

    expect(output.join('\n')).toContain('finance split groups');
  });
});

describe('給人看的輸出', () => {
  it('show 印表格、8 碼 id，並標明總筆數與顯示筆數', async () => {
    await splitCommand({ positional: ['show', '日本行'], flags: { limit: '1' } });

    const text = output.join('\n');
    expect(text).toContain('─');
    expect(text).toContain('a3f9c21b');
    expect(text).not.toContain(EXPENSE.id);
    expect(text).toContain('共 25 筆，顯示前 1 筆');
    expect(text).toContain('每人總支出');
    expect(text).toContain('小明 付給 Doris NT$1,000');
  });

  it('settle 走旗標，方向照 --from → --to', async () => {
    await splitCommand({ positional: ['settle'], flags: { from: '小明', to: '我', amount: '500' } });

    expect(splitExpenses.addSettlement).toHaveBeenCalledWith(
      expect.objectContaining({
        fromMember: expect.objectContaining({ name: '小明' }),
        toMember: expect.objectContaining({ name: 'Doris' }),
        amount: 500,
        currency: 'TWD',
      })
    );
    expect(output.join('\n')).toContain('小明 付給 Doris NT$500');
  });

  it('rm 接受表格上的 8 碼 id', async () => {
    await splitCommand({ positional: ['rm', 'a3f9c21b'], flags: {} });

    expect(splitExpenses.getExpense).toHaveBeenCalledWith('a3f9c21b');
    expect(splitExpenses.deleteExpense).toHaveBeenCalled();
    expect(output.join('\n')).toContain('已刪除');
  });
});

describe('edit 改金額時的分攤', () => {
  it('原本是均分就依新金額重算', async () => {
    await splitCommand({ positional: ['edit', EXPENSE.id], flags: { amount: '3600' } });

    expect(splitExpenses.updateExpense).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 3600,
        shares: [
          { member_id: 'm1', share: 1200 },
          { member_id: 'm2', share: 1200 },
          { member_id: 'm3', share: 1200 },
        ],
      })
    );
  });

  it('原本是自訂分攤就報錯，hint 列出原本每個人的金額', async () => {
    splitExpenses.getExpense.mockResolvedValueOnce({
      ...EXPENSE,
      split_expense_shares: [
        { id: 's1', member_id: 'm1', share: 1800 },
        { id: 's2', member_id: 'm2', share: 600 },
        { id: 's3', member_id: 'm3', share: 600 },
      ],
    });

    await expect(
      splitCommand({ positional: ['edit', EXPENSE.id], flags: { amount: '3600' } })
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      hint: expect.stringContaining('Doris=1800'),
    });

    expect(splitExpenses.updateExpense).not.toHaveBeenCalled();
  });

  it('只改標題時把原分攤原樣送回（RPC 不接受空分攤）', async () => {
    await splitCommand({ positional: ['edit', EXPENSE.id], flags: { title: '晚餐' } });

    expect(splitExpenses.updateExpense).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '晚餐',
        amount: 3000,
        shares: [
          { member_id: 'm1', share: 1000 },
          { member_id: 'm2', share: 1000 },
          { member_id: 'm3', share: 1000 },
        ],
      })
    );
  });
});
