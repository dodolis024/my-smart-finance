import { describe, it, expect } from 'vitest';
import * as web from '@/lib/overseasFee';
import * as cli from '../../tools/core/overseasFee.js';

const { computeTwdWithFee, getOverseasFeeRate, getOverseasAutoCheck, defaultOverseasChecked } = web;

describe('computeTwdWithFee', () => {
  it('沒有費率時 overseasFee 是 null（非海外），合計等於本體', () => {
    expect(computeTwdWithFee(10, 42.035, null)).toEqual({ baseTwd: 420.35, overseasFee: null, twdAmount: 420.35 });
  });

  it('GBP 10 × 42.035 × 1.5%：本體 420.35、手續費 6.31（6.30525 進位）、合計 426.66', () => {
    expect(computeTwdWithFee(10, 42.035, 1.5)).toEqual({ baseTwd: 420.35, overseasFee: 6.31, twdAmount: 426.66 });
  });

  it('台幣 100 × 1.5% = 101.5', () => {
    expect(computeTwdWithFee(100, 1, 1.5)).toEqual({ baseTwd: 100, overseasFee: 1.5, twdAmount: 101.5 });
  });

  it.each([
    ['0', 0],
    ['負數', -1],
    ['非數字字串', 'abc'],
    ['undefined', undefined],
  ])('費率 %s 視為沒有費率', (_label, rate) => {
    expect(computeTwdWithFee(10, 42.035, rate)).toEqual({ baseTwd: 420.35, overseasFee: null, twdAmount: 420.35 });
  });

  it('資料庫回傳的 NUMERIC 字串費率也能算', () => {
    expect(computeTwdWithFee(10, 42.035, '1.500').overseasFee).toBe(6.31);
  });

  it('零小數幣別的大金額（JPY）捨入到分', () => {
    expect(computeTwdWithFee(1234567, 0.2113, 1.5)).toEqual({
      baseTwd: 260864.01,
      overseasFee: 3912.96,
      twdAmount: 264776.97,
    });
  });
});

describe('getOverseasFeeRate', () => {
  it('RPC 駝峰與資料表蛇形欄位都吃', () => {
    expect(getOverseasFeeRate({ type: 'credit_card', overseasFeeRate: 1.5 })).toBe(1.5);
    expect(getOverseasFeeRate({ type: 'credit_card', overseas_fee_rate: '1.500' })).toBe(1.5);
  });

  it('簽帳金融卡也有效', () => {
    expect(getOverseasFeeRate({ type: 'debit_card', overseas_fee_rate: 2 })).toBe(2);
  });

  it.each(['cash', 'bank', 'digital_wallet'])('%s 一律 null（即使欄位殘留費率）', (type) => {
    expect(getOverseasFeeRate({ type, overseas_fee_rate: 1.5 })).toBeNull();
  });

  it('未設定、空字串、0、沒有帳戶都回 null', () => {
    expect(getOverseasFeeRate({ type: 'credit_card' })).toBeNull();
    expect(getOverseasFeeRate({ type: 'credit_card', overseasFeeRate: '' })).toBeNull();
    expect(getOverseasFeeRate({ type: 'credit_card', overseasFeeRate: 0 })).toBeNull();
    expect(getOverseasFeeRate(null)).toBeNull();
    expect(getOverseasFeeRate(undefined)).toBeNull();
  });
});

describe('getOverseasAutoCheck', () => {
  it('欄位不存在（舊快取）或 null 視為開，與資料庫預設一致', () => {
    expect(getOverseasAutoCheck({})).toBe(true);
    expect(getOverseasAutoCheck({ overseasFeeAutoCheck: null })).toBe(true);
    expect(getOverseasAutoCheck(undefined)).toBe(true);
  });

  it('明確關閉才是 false（駝峰、蛇形皆可）', () => {
    expect(getOverseasAutoCheck({ overseasFeeAutoCheck: false })).toBe(false);
    expect(getOverseasAutoCheck({ overseas_fee_auto_check: false })).toBe(false);
  });
});

describe('defaultOverseasChecked', () => {
  const card = { type: 'credit_card', overseasFeeRate: 1.5, overseasFeeAutoCheck: true };

  it('外幣＋有費率＋自動開 → 勾選', () => {
    expect(defaultOverseasChecked(card, 'GBP', 'expense')).toBe(true);
    expect(defaultOverseasChecked(card, ' gbp ', 'expense')).toBe(true);
  });

  it('收入不勾', () => {
    expect(defaultOverseasChecked(card, 'GBP', 'income')).toBe(false);
  });

  it('台幣不勾（在國外網站刷台幣要使用者自己勾）', () => {
    expect(defaultOverseasChecked(card, 'TWD', 'expense')).toBe(false);
  });

  it('沒有費率不勾', () => {
    expect(defaultOverseasChecked({ type: 'credit_card' }, 'GBP', 'expense')).toBe(false);
    expect(defaultOverseasChecked({ type: 'cash', overseasFeeRate: 1.5 }, 'GBP', 'expense')).toBe(false);
    expect(defaultOverseasChecked(undefined, 'GBP', 'expense')).toBe(false);
  });

  it('自動勾選關閉不勾', () => {
    expect(defaultOverseasChecked({ ...card, overseasFeeAutoCheck: false }, 'GBP', 'expense')).toBe(false);
  });
});

/**
 * 網頁與 CLI 各有一份（CLI 無法匯入 src/）。兩份算出不同的手續費，
 * 同一筆消費從網頁記和從 CLI 記就會對不上——這組測試是唯一防線，不可刪。
 */
describe('src/lib/overseasFee.js 與 tools/core/overseasFee.js 一致', () => {
  it('匯出的名稱相同', () => {
    expect(Object.keys(cli).sort()).toEqual(Object.keys(web).sort());
    expect(cli.OVERSEAS_FEE_ACCOUNT_TYPES).toEqual(web.OVERSEAS_FEE_ACCOUNT_TYPES);
  });

  it('金額 × 匯率 × 費率格點（含浮點捨入邊界）算出完全相同的結果', () => {
    const amounts = [0.01, 1, 3.33, 10, 19.99, 99.95, 420.35, 1000, 1234567, 99999999.99];
    const rates = [1, 0.0021, 0.2113, 4.5, 31.456, 42.035, 42.0351];
    const feeRates = [null, 0, 0.5, 1, 1.5, 1.75, 2, 2.5, 3, 10, '1.500'];
    for (const a of amounts) {
      for (const r of rates) {
        for (const f of feeRates) {
          expect(cli.computeTwdWithFee(a, r, f)).toEqual(web.computeTwdWithFee(a, r, f));
        }
      }
    }
  });

  it('帳戶判斷函式行為相同', () => {
    const accounts = [
      null,
      { type: 'credit_card', overseasFeeRate: 1.5 },
      { type: 'debit_card', overseas_fee_rate: '2.000', overseas_fee_auto_check: false },
      { type: 'cash', overseas_fee_rate: 1.5 },
      { type: 'credit_card', overseasFeeRate: 0 },
    ];
    for (const acc of accounts) {
      expect(cli.getOverseasFeeRate(acc)).toBe(web.getOverseasFeeRate(acc));
      expect(cli.getOverseasAutoCheck(acc)).toBe(web.getOverseasAutoCheck(acc));
      for (const cur of ['TWD', 'GBP']) {
        for (const type of ['expense', 'income']) {
          expect(cli.defaultOverseasChecked(acc, cur, type)).toBe(web.defaultOverseasChecked(acc, cur, type));
        }
      }
    }
  });
});
