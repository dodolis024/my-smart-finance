import { describe, it, expect } from 'vitest';
import { buildTransactionsCsv, csvEscape } from '@/lib/csvExport';

const labels = {
  headers: ['日期', '類型', '分類', '項目', '支付方式', '幣別', '金額', '台幣金額', '備註', '時間', '匯率', '手續費'],
  typeLabels: { expense: '支出', income: '收入' },
};

const baseRow = {
  date: '2026-07-01',
  type: 'expense',
  category: '飲食',
  itemName: '拿鐵',
  paymentMethod: '信用卡A',
  currency: 'TWD',
  originalAmount: 120,
  twdAmount: 120,
  note: '',
};

describe('csvEscape', () => {
  it('含逗號/雙引號/換行時以雙引號包裹並將內部引號加倍', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('he said "hi"')).toBe('"he said ""hi"""');
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  });

  it('一般值與 null/undefined 原樣輸出', () => {
    expect(csvEscape('普通')).toBe('普通');
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
    expect(csvEscape(120)).toBe('120');
  });

  it('開頭是 = + - @ 或 tab／CR 的文字前置單引號，Excel 才不會當公式執行', () => {
    expect(csvEscape('=HYPERLINK("http://x","點我")')).toBe('"\'=HYPERLINK(""http://x"",""點我"")"');
    expect(csvEscape('=cmd|\' /C calc\'!A0')).toBe("'=cmd|' /C calc'!A0");
    expect(csvEscape('+1+1')).toBe("'+1+1");
    expect(csvEscape('-50 折扣')).toBe("'-50 折扣");
    expect(csvEscape('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvEscape('\t=1')).toBe("'\t=1");
    expect(csvEscape('\r=1')).toBe('"\'\r=1"');
  });

  it('數值欄位不會被加單引號（負數金額仍要能運算）', () => {
    expect(csvEscape(-50)).toBe('-50');
    expect(csvEscape(0)).toBe('0');
  });
});

describe('buildTransactionsCsv 公式注入', () => {
  it('分帳同步來的項目名稱與備註若以 = 開頭，匯出時會被中和', () => {
    const csv = buildTransactionsCsv(
      [{ ...baseRow, itemName: '=HYPERLINK("http://evil","晚餐")', note: '=1+1' }],
      labels
    );
    const line = csv.replace('﻿', '').trimEnd().split('\r\n')[1];
    expect(line).toContain('"\'=HYPERLINK(""http://evil"",""晚餐"")"');
    expect(line).toContain(",'=1+1,");
    expect(line).not.toMatch(/,=HYPERLINK/);
  });
});

describe('buildTransactionsCsv', () => {
  it('開頭是 UTF-8 BOM，行尾是 CRLF', () => {
    const csv = buildTransactionsCsv([baseRow], labels);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv).toContain('\r\n');
  });

  it('表頭與資料列欄位順序固定為 12 欄，前 9 欄位置與舊版相同', () => {
    const csv = buildTransactionsCsv([baseRow], labels);
    const lines = csv.replace('﻿', '').trimEnd().split('\r\n');
    expect(lines[0]).toBe('日期,類型,分類,項目,支付方式,幣別,金額,台幣金額,備註,時間,匯率,手續費');
    expect(lines[1]).toBe('2026-07-01,支出,飲食,拿鐵,信用卡A,TWD,120,120,,,,');
  });

  it('時間只留到分、匯率與手續費照存的值輸出；離線佇列的蛇形欄位也吃得到', () => {
    const rpcRow = { ...baseRow, time: '08:30:00', currency: 'GBP', originalAmount: 10, exchangeRate: 42.035, twdAmount: 426.65, overseasFee: 6.31 };
    const lines = buildTransactionsCsv([rpcRow], labels).replace('﻿', '').trimEnd().split('\r\n');
    expect(lines[1]).toBe('2026-07-01,支出,飲食,拿鐵,信用卡A,GBP,10,426.65,,08:30,42.035,6.31');
    const queuedRow = { ...baseRow, time: '21:05', exchange_rate: 1, overseas_fee: null };
    expect(buildTransactionsCsv([queuedRow], labels)).toContain(',120,120,,21:05,1,');
  });

  it('income 對映收入標籤', () => {
    const csv = buildTransactionsCsv([{ ...baseRow, type: 'income' }], labels);
    expect(csv).toContain(',收入,');
  });

  it('originalAmount 缺時回退 amount（離線佇列列形狀），兩者皆缺輸出空字串', () => {
    const queued = { ...baseRow, originalAmount: undefined, amount: 99 };
    expect(buildTransactionsCsv([queued], labels)).toContain(',99,120,');
    const none = { ...baseRow, originalAmount: null };
    const lines = buildTransactionsCsv([none], labels).replace('﻿', '').trimEnd().split('\r\n');
    expect(lines[1]).toBe('2026-07-01,支出,飲食,拿鐵,信用卡A,TWD,,120,,,,');
  });

  it('備註含逗號與引號時正確跳脫', () => {
    const csv = buildTransactionsCsv([{ ...baseRow, note: '跟朋友,說 "讚"' }], labels);
    expect(csv).toContain('"跟朋友,說 ""讚"""');
  });

  it('空列表只輸出表頭', () => {
    const csv = buildTransactionsCsv([], labels);
    expect(csv.replace('﻿', '').trimEnd().split('\r\n')).toHaveLength(1);
  });
});
