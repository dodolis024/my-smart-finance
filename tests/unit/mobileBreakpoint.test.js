// @vitest-environment node
/**
 * 單元測試 - 行動版斷點一致性
 *
 * 行動版斷點(600px)同時寫在兩處:CSS 的 @media 與 JS 的 matchMedia。
 * 這個測試不消除重複(硬要統一反而讓程式碼多繞一層),只負責在改動時攔住漏網之魚:
 *   - 只改了三個 JS 檔的其中一兩個 → 值不一致,測試失敗
 *   - 改了 CSS 的 @media 卻沒動 JS → JS 的值在 CSS 裡找不到,測試失敗
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// 以 vitest 的執行根目錄為準(import.meta.url 在 jsdom 環境下不是 file: 路徑)
const SRC_DIR = join(process.cwd(), 'src');

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

/** 收集 matchMedia('(max-width: Npx)') 的斷點值與出現位置 */
function collectJsBreakpoints(source, label) {
  const hits = [];
  source.split('\n').forEach((line, index) => {
    const match = line.match(/matchMedia\(\s*['"`]\(max-width:\s*(\d+)px\)['"`]/);
    if (match) hits.push({ value: Number(match[1]), where: `${label}:${index + 1}` });
  });
  return hits;
}

/** 收集 @media (max-width: Npx) 的斷點值 */
function collectCssBreakpoints(source) {
  return [...source.matchAll(/@media[^{]*?max-width:\s*(\d+)px/g)].map((m) => Number(m[1]));
}

const files = listFiles(SRC_DIR);

const jsHits = files
  .filter((file) => /\.(js|jsx)$/.test(file))
  .flatMap((file) => collectJsBreakpoints(readFileSync(file, 'utf8'), relative(SRC_DIR, file)));

const cssBreakpoints = new Set(
  files
    .filter((file) => file.endsWith('.css'))
    .flatMap((file) => collectCssBreakpoints(readFileSync(file, 'utf8')))
);

describe('行動版斷點 - CSS 與 JS 一致', () => {
  it('src/ 內確實有 matchMedia 斷點可供檢查', () => {
    // 防止日後 matchMedia 被改寫成別的寫法,讓這個測試變成永遠通過的空殼
    expect(jsHits.length).toBeGreaterThan(0);
  });

  it('所有 JS 的 matchMedia 斷點值應一致', () => {
    const values = [...new Set(jsHits.map((hit) => hit.value))];
    const detail = jsHits.map((hit) => `${hit.where} → ${hit.value}px`).join('\n');

    expect(values, `JS 的 matchMedia 出現多個斷點值,改動時可能漏了某幾處:\n${detail}`).toHaveLength(1);
  });

  it('JS 的斷點值應在 CSS 的 @media 中存在', () => {
    const value = jsHits[0].value;
    const detail = jsHits.map((hit) => hit.where).join(', ');

    expect(
      cssBreakpoints.has(value),
      `JS 用 ${value}px 但 CSS 的 @media 沒有這個斷點(CSS 現有:${[...cssBreakpoints].sort((a, b) => a - b).join(', ')}px)。` +
        `改了 CSS 卻沒改 JS 嗎?需一起更新:${detail}`
    ).toBe(true);
  });
});

describe('行動版斷點 - 檢查邏輯本身', () => {
  it('抓得到 JS 的斷點值與行號', () => {
    const source = ['const a = 1;', "if (window.matchMedia('(max-width: 640px)').matches) {}"].join('\n');

    expect(collectJsBreakpoints(source, 'x.js')).toEqual([{ value: 640, where: 'x.js:2' }]);
  });

  it('抓得到 CSS 的 @media 斷點值,且不誤抓一般的 max-width 屬性', () => {
    const source = ['.card { max-width: 220px; }', '@media (max-width: 600px) { .card { width: 100%; } }'].join('\n');

    expect(collectCssBreakpoints(source)).toEqual([600]);
  });
});
