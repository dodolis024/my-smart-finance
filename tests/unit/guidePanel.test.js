import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

// t 直接回傳 key：這裡驗的是結構與互動，不是文案內容
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, lang: 'zh' }),
}));

const { default: GuidePanel } = await import('@/components/settings/unified/GuidePanel');
const { TABS } = await import('@/components/settings/unified/UnifiedTabIcons');

let container;
let root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render() {
  act(() => root.render(createElement(GuidePanel)));
}

describe('設定分頁清單', () => {
  it('使用說明排在訂閱管理後面，是最後一項', () => {
    const ids = TABS.map((tab) => tab.id);

    expect(ids.indexOf('guide')).toBe(ids.indexOf('subscription') + 1);
    expect(ids[ids.length - 1]).toBe('guide');
  });

  it('只有使用說明標記為電腦版限定', () => {
    const desktopOnly = TABS.filter((tab) => tab.desktopOnly).map((tab) => tab.id);

    expect(desktopOnly).toEqual(['guide']);
  });

  it('手機版 tab bar 過濾後不包含使用說明，其餘五項都在', () => {
    const mobileTabs = TABS.filter((tab) => !tab.desktopOnly).map((tab) => tab.id);

    expect(mobileTabs).not.toContain('guide');
    expect(mobileTabs).toHaveLength(5);
  });
});

describe('GuidePanel', () => {
  it('四個步驟，每個指令區塊都有複製按鈕', () => {
    render();

    expect(container.querySelectorAll('.guide-step')).toHaveLength(4);
    // 5 個區塊：安裝、更新、登入、記帳，加上給 AI 助理的查詢範例
    expect(container.querySelectorAll('.guide-code')).toHaveLength(5);
    expect(container.querySelectorAll('.guide-code__copy')).toHaveLength(5);
  });

  it('指令內容不會被翻譯層吃掉（i18n mock 下仍是真實指令）', () => {
    render();

    const codes = [...container.querySelectorAll('.guide-code__text')].map((el) => el.textContent);

    expect(codes[0]).toBe('npm install -g my-smart-finance-cli');
    expect(codes[1]).toBe('npm update -g my-smart-finance-cli');
    expect(codes[2]).toBe('finance login');
  });

  it('不再出現 MCP 設定（該功能已暫緩）', () => {
    render();

    expect(container.textContent).not.toContain('mcpServers');
    expect(container.textContent).not.toContain('mcp_servers');
  });

  it('進階區塊預設收合', () => {
    render();

    expect(container.querySelectorAll('.guide-collapsible')).toHaveLength(3);
    expect(container.querySelector('.guide-collapsible__body')).toBeNull();
    container.querySelectorAll('.guide-collapsible__head').forEach((head) => {
      expect(head.getAttribute('aria-expanded')).toBe('false');
    });
  });

  it('點擊標題可展開該區塊，其他維持收合', () => {
    render();

    const heads = container.querySelectorAll('.guide-collapsible__head');
    act(() => heads[0].dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(container.querySelectorAll('.guide-collapsible__body')).toHaveLength(1);
    expect(heads[0].getAttribute('aria-expanded')).toBe('true');
    expect(heads[1].getAttribute('aria-expanded')).toBe('false');
  });

  it('展開後可再次點擊收合', () => {
    render();

    const head = container.querySelectorAll('.guide-collapsible__head')[0];
    act(() => head.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    act(() => head.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(container.querySelector('.guide-collapsible__body')).toBeNull();
  });

  it('複製按鈕會把該段指令寫入剪貼簿', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    render();
    const button = container.querySelectorAll('.guide-code__copy')[2];
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(writeText).toHaveBeenCalledWith('finance login');
    vi.unstubAllGlobals();
  });
});
