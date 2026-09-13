import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * --overseas / --no-overseas 是開關。args.js 會把旗標後面緊接的字當成值吃掉，
 * `finance add 午餐 --overseas 10` 會讓金額消失——這裡守住「收到值就報錯」，不要改成容錯猜測。
 */

const mocks = vi.hoisted(() => ({ addInput: null, editPatch: null, addResult: null, editResult: null }));

vi.mock('../../tools/core/transactions.js', () => ({
  addTransaction: async (input) => {
    mocks.addInput = input;
    return mocks.addResult;
  },
  updateTransaction: async (_id, patch) => {
    mocks.editPatch = patch;
    return mocks.editResult;
  },
  listTransactions: async () => [],
  deleteTransaction: async () => ({}),
}));

const { parseArgs } = await import('../../tools/cli/args.js');
const { addCommand, editCommand, parseOverseasFlag } = await import('../../tools/cli/commands/transactions.js');

const TX = {
  id: 'tx-1',
  date: '2026-09-13',
  time: '12:00',
  type: 'expense',
  item_name: '午餐',
  category: '飲食',
  payment_method: '英國卡',
  currency: 'GBP',
  amount: 10,
  exchange_rate: 42.035,
  twd_amount: 426.66,
  overseas_fee_rate: 1.5,
  overseas_fee: 6.31,
};

let output;
let logSpy;

beforeEach(() => {
  mocks.addInput = null;
  mocks.editPatch = null;
  mocks.addResult = { transaction: TX, checkedIn: false };
  mocks.editResult = { before: { ...TX, twd_amount: 420.35, overseas_fee_rate: null, overseas_fee: null }, after: TX };
  output = [];
  logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => output.push(args.join(' ')));
});

afterEach(() => {
  logSpy.mockRestore();
});

const flagsOf = (argv) => parseArgs(argv).flags;

describe('parseOverseasFlag', () => {
  it('沒給 → undefined（依帳戶預設）', () => {
    expect(parseOverseasFlag(flagsOf(['午餐', '10']))).toBeUndefined();
  });

  it('--overseas → true；--no-overseas → false', () => {
    expect(parseOverseasFlag(flagsOf(['午餐', '10', '--overseas']))).toBe(true);
    expect(parseOverseasFlag(flagsOf(['午餐', '10', '--no-overseas']))).toBe(false);
    expect(parseOverseasFlag(flagsOf(['午餐', '10', '--overseas', '--currency', 'GBP']))).toBe(true);
  });

  it('`--overseas 10` 把金額吃掉 → 報「是開關，不接值」', () => {
    expect(() => parseOverseasFlag(flagsOf(['午餐', '--overseas', '10']))).toThrow(
      expect.objectContaining({ code: 'INVALID_INPUT', message: expect.stringContaining('是開關，不接值') })
    );
  });

  it('`--no-overseas 10` 同樣報錯', () => {
    expect(() => parseOverseasFlag(flagsOf(['午餐', '--no-overseas', '10']))).toThrow(
      expect.objectContaining({ code: 'INVALID_INPUT' })
    );
  });

  it('`--overseas=yes` 也不接受', () => {
    expect(() => parseOverseasFlag(flagsOf(['午餐', '10', '--overseas=yes']))).toThrow(
      expect.objectContaining({ code: 'INVALID_INPUT' })
    );
  });

  it('兩個同時給 → 報錯', () => {
    expect(() => parseOverseasFlag(flagsOf(['午餐', '10', '--overseas', '--no-overseas']))).toThrow(
      expect.objectContaining({ code: 'INVALID_INPUT', message: expect.stringContaining('不能同時使用') })
    );
  });
});

describe('add / edit 指令', () => {
  it('add 把旗標轉成 overseas 傳給核心', async () => {
    await addCommand(parseArgs(['午餐', '10', '--category', '飲食', '--account', '英國卡', '--overseas']));
    expect(mocks.addInput).toMatchObject({ itemName: '午餐', amount: '10', overseas: true });
  });

  it('add 沒給旗標時 overseas 是 undefined，讓核心依帳戶預設', async () => {
    await addCommand(parseArgs(['午餐', '10', '--category', '飲食', '--account', '英國卡']));
    expect(mocks.addInput.overseas).toBeUndefined();
  });

  it('add 輸出含手續費附註', async () => {
    await addCommand(parseArgs(['午餐', '10', '--category', '飲食', '--account', '英國卡', '--currency', 'GBP']));
    expect(output[0]).toContain('約 NT$426.66，含海外手續費 NT$6.31');
  });

  it('台幣交易有手續費時也顯示換算與附註', async () => {
    mocks.addResult = {
      transaction: { ...TX, currency: 'TWD', amount: 100, exchange_rate: 1, twd_amount: 101.5, overseas_fee: 1.5 },
      checkedIn: false,
    };
    await addCommand(parseArgs(['網購', '100', '--category', '飲食', '--account', '英國卡', '--overseas']));
    expect(output[0]).toContain('約 NT$101.5，含海外手續費 NT$1.5');
  });

  it('台幣交易沒有手續費時維持原本輸出（不顯示換算）', async () => {
    mocks.addResult = {
      transaction: { ...TX, currency: 'TWD', amount: 100, exchange_rate: 1, twd_amount: 100, overseas_fee_rate: null, overseas_fee: null },
      checkedIn: false,
    };
    await addCommand(parseArgs(['網購', '100', '--category', '飲食', '--account', '現金']));
    expect(output[0]).not.toContain('NT$');
  });

  it('edit 只在有給旗標時才把 overseas 放進 patch', async () => {
    await editCommand(parseArgs(['tx-1', '--note', '好吃']));
    expect(mocks.editPatch).toEqual({ note: '好吃' });

    await editCommand(parseArgs(['tx-1', '--no-overseas']));
    expect(mocks.editPatch).toEqual({ overseas: false });
  });

  it('edit 之後的那行附註手續費', async () => {
    await editCommand(parseArgs(['tx-1', '--overseas']));
    const afterLine = output.find((line) => line.includes('之後'));
    expect(afterLine).toContain('含海外手續費 NT$6.31');
    const beforeLine = output.find((line) => line.includes('之前'));
    expect(beforeLine).not.toContain('手續費');
  });
});
