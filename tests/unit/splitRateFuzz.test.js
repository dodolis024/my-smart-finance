import { describe, it, expect } from 'vitest';
import * as web from '@/lib/splitSettlement';
import * as cli from '../../tools/core/splitSettlement.js';

/**
 * 凍結匯率的暴力測試。
 *
 * 凍結匯率要解決的是「同一筆外幣費用換算後的金額每天浮動，結清後又冒出零頭」。
 * 這裡用隨機群組、隨機費用、隨機亂跳的即時匯率去撞，守住四件事：
 *   1. 全部費用都有凍結匯率時，即時匯率怎麼跳，結算建議與每人總額都不變
 *   2. 照建議付款結清後，即時匯率怎麼跳都不會再冒出待結算
 *   3. 網頁與 CLI 兩份實作在任何輸入下結果完全相同
 *   4. 塞進奇怪的值（0、負數、字串、缺幣別）也不會算出 NaN 或 Infinity
 */

let seed = 1;
const reseed = (v) => { seed = v; };
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (n) => Math.floor(rnd() * n);

const BASE = { TWD: 1, USD: 31.5, JPY: 0.21, EUR: 35, KRW: 0.0235 };
const FOREIGN = ['USD', 'JPY', 'EUR', 'KRW'];
const SEEDS = [777, 20260910, 42, 987654321, 13];

const members = (n) => Array.from({ length: n }, (_, i) => ({ id: `m${i + 1}`, name: `成員${i + 1}` }));

/** 某幣別在「記帳當天」的匯率：以基準值上下浮動 30% */
const dayRate = (cur) => (cur === 'TWD' ? 1 : Number((BASE[cur] * (0.7 + rnd() * 0.6)).toFixed(6)));

/** 隨機亂跳的即時匯率，偶爾整組缺幣別或出現 0 */
function liveRates() {
  const r = { TWD: 1 };
  FOREIGN.forEach((c) => {
    const roll = rnd();
    if (roll < 0.05) return; // 缺這個幣別
    if (roll < 0.08) { r[c] = 0; return; }
    r[c] = BASE[c] * (0.3 + rnd() * 3);
  });
  return r;
}

function randomExpenses(ms, { frozen = true } = {}) {
  return Array.from({ length: 1 + int(8) }, () => {
    const currency = pick(['TWD', ...FOREIGN]);
    const amount = currency === 'KRW' ? 1000 + int(200000) : 1 + int(5000);
    const parts = ms.filter(() => rnd() > 0.3);
    const list = parts.length ? parts : [ms[0]];
    const base = Math.floor((amount / list.length) * 100) / 100;
    const shares = list.map((m, i) => ({
      member_id: m.id,
      share: i === 0 ? Number((amount - base * (list.length - 1)).toFixed(2)) : base,
    }));
    const rate = dayRate(currency);
    return {
      paid_by: pick(ms).id,
      amount,
      currency,
      // DB 回傳 numeric 可能是數字也可能是字串，兩種都要能用
      exchange_rate: frozen ? pick([rate, String(rate.toFixed(6))]) : null,
      split_expense_shares: shares,
    };
  });
}

describe('凍結匯率暴力測試', () => {
  it.each(SEEDS)('種子 %i：費用都已凍結時，即時匯率怎麼跳，結算建議與每人總額都不變', (s) => {
    reseed(s);
    const drifted = [];
    for (let round = 0; round < 300; round++) {
      const ms = members(2 + int(5));
      const expenses = randomExpenses(ms);
      const baseline = web.calcSettlement(ms, expenses, [], BASE, 'TWD');
      const baseTotals = web.calcMemberTotals(ms, expenses, BASE, 'TWD');
      for (let k = 0; k < 10; k++) {
        const rates = liveRates();
        const now = web.calcSettlement(ms, expenses, [], rates, 'TWD');
        const totals = web.calcMemberTotals(ms, expenses, rates, 'TWD');
        const totalsMoved = ms.some((m) => Math.abs(totals[m.id] - baseTotals[m.id]) > 1e-9);
        if (JSON.stringify(now) !== JSON.stringify(baseline) || totalsMoved) {
          drifted.push({ round, rates, baseline, now });
        }
      }
    }
    if (drifted.length) console.log('匯率一跳就變：', JSON.stringify(drifted.slice(0, 3)));
    expect(drifted).toEqual([]);
  });

  it.each(SEEDS)('種子 %i：照建議付款結清後，即時匯率怎麼跳都不會再冒出待結算', (s) => {
    reseed(s);
    const reopened = [];
    for (let round = 0; round < 300; round++) {
      const ms = members(2 + int(5));
      const expenses = randomExpenses(ms);
      const first = web.calcSettlement(ms, expenses, [], liveRates(), 'TWD');
      // 還款用群組幣別（台幣）記錄，trigger 會把台幣凍結成 1
      const paid = first.map((t) => ({
        from_member: t.fromId, to_member: t.toId, amount: t.amount, currency: 'TWD', exchange_rate: 1,
      }));
      for (let k = 0; k < 10; k++) {
        const rates = liveRates();
        const after = web.calcSettlement(ms, expenses, paid, rates, 'TWD');
        if (after.length) reopened.push({ round, rates, after });
      }
    }
    if (reopened.length) console.log('結清後又冒出：', JSON.stringify(reopened.slice(0, 3)));
    expect(reopened).toEqual([]);
  });

  it.each(SEEDS)('種子 %i：網頁與 CLI 在任何輸入下結果完全相同（含舊資料混用、非台幣群組）', (s) => {
    reseed(s);
    const diverged = [];
    for (let round = 0; round < 300; round++) {
      const ms = members(2 + int(5));
      // 新舊資料混用：每筆各自決定有沒有凍結匯率
      const expenses = randomExpenses(ms).map((e) => (rnd() < 0.4 ? { ...e, exchange_rate: null } : e));
      const target = pick(['TWD', 'USD', 'JPY', 'KRW']);
      const settlements = Array.from({ length: int(3) }, () => {
        const currency = pick(['TWD', target, ...FOREIGN]);
        return {
          from_member: pick(ms).id, to_member: pick(ms).id,
          amount: 1 + int(2000), currency,
          exchange_rate: rnd() < 0.7 ? dayRate(currency) : null,
        };
      });
      const rates = liveRates();
      const a = [web.calcSettlement(ms, expenses, settlements, rates, target), web.calcMemberTotals(ms, expenses, rates, target)];
      const b = [cli.calcSettlement(ms, expenses, settlements, rates, target), cli.calcMemberTotals(ms, expenses, rates, target)];
      if (JSON.stringify(a) !== JSON.stringify(b)) diverged.push({ round, target });
    }
    expect(diverged).toEqual([]);
  });

  it.each(SEEDS)('種子 %i：奇怪的匯率值也不會算出 NaN、Infinity 或非正數的轉帳', (s) => {
    reseed(s);
    const WEIRD_RATE = [0, -1, '0', 'abc', '', null, undefined, NaN, Infinity, 1e-9, 1e6, '31.5'];
    const bad = [];
    for (let round = 0; round < 300; round++) {
      const ms = members(2 + int(5));
      const expenses = randomExpenses(ms).map((e) => ({
        ...e,
        currency: rnd() < 0.1 ? pick([undefined, '', 'XYZ']) : e.currency,
        exchange_rate: rnd() < 0.5 ? pick(WEIRD_RATE) : e.exchange_rate,
      }));
      const rates = rnd() < 0.2 ? pick([undefined, null, {}]) : liveRates();
      const target = pick(['TWD', 'USD', 'JPY', undefined]);
      const result = web.calcSettlement(ms, expenses, [], rates, target);
      const totals = web.calcMemberTotals(ms, expenses, rates, target);
      if (result.some((t) => !Number.isFinite(t.amount) || t.amount <= 0)) bad.push({ round, result });
      if (Object.values(totals).some((v) => !Number.isFinite(v))) bad.push({ round, totals });
    }
    if (bad.length) console.log('算出怪數字：', JSON.stringify(bad.slice(0, 3)));
    expect(bad).toEqual([]);
  });

  it.each(SEEDS)('種子 %i：同幣別永遠不換算，凍結值與即時值再怎麼不同都是 1', (s) => {
    reseed(s);
    for (let round = 0; round < 500; round++) {
      const currency = pick(['TWD', ...FOREIGN]);
      const row = { currency, exchange_rate: pick([dayRate(currency), null, '0.5', 999]) };
      expect(web.conversionFactor(row, liveRates(), currency)).toBe(1);
      expect(cli.conversionFactor(row, liveRates(), currency)).toBe(1);
    }
  });
});
