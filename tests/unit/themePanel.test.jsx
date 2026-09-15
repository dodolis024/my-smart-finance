import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * 主題輪換的展開入口。
 *
 * 總開關放在標題列上，按開關只切換輪換、不展開；
 * 輪換關閉時照樣可以展開，內容變灰，讓使用者先預覽、先調好再開。
 */

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// 手機版一次只展開一區，靠 matchMedia 判斷；jsdom 沒有這個 API
window.matchMedia = window.matchMedia || ((query) => ({
  matches: false, media: query, addEventListener() {}, removeEventListener() {},
}));

const h = vi.hoisted(() => ({
  theme: {
    theme: 'default', setTheme: vi.fn(),
    shuffleEnabled: false, setShuffleEnabled: vi.fn(),
    shuffleThemes: ['default', 'rose'], setShuffleThemes: vi.fn(),
    shuffleInterval: 'daily', setShuffleInterval: vi.fn(),
  },
}));

vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k) => k, lang: 'zh' }) }));
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => h.theme }));

const ThemePanel = (await import('@/components/settings/unified/ThemePanel')).default;

let container, root;
beforeEach(() => {
  h.theme.shuffleEnabled = false;
  h.theme.setShuffleEnabled.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const render = () => act(() => { root.render(createElement(ThemePanel)); });
const header = () => container.querySelector('.disclosure-row');
const click = (el) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

describe('主題輪換標題列', () => {
  it('收合時就顯示狀態：關閉時寫「未開啟」，開啟時寫輪換頻率', () => {
    render();
    expect(header().textContent).toContain('settings.theme.shuffleStatusOff');

    h.theme.shuffleEnabled = true;
    render();
    expect(header().textContent).toContain('settings.theme.intervals.daily');
  });

  it('收合時按開關只切換輪換，不會把區塊展開', () => {
    render();
    click(header().querySelector('[role="switch"]'));

    expect(h.theme.setShuffleEnabled).toHaveBeenCalledWith(true);
    expect(header().querySelector('[aria-expanded]').getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.theme-shuffle')).toBeNull();
  });

  it('點標題列才展開', () => {
    render();
    click(header());

    expect(header().querySelector('[aria-expanded]').getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.theme-shuffle')).not.toBeNull();
  });
});

describe('展開內容', () => {
  it('輪換關閉時照樣展開，內容變灰', () => {
    render();
    click(header());

    expect(container.querySelector('.theme-shuffle__options').classList.contains('settings-dimmed')).toBe(true);
  });

  it('輪換開啟時內容不變灰', () => {
    h.theme.shuffleEnabled = true;
    render();
    click(header());

    expect(container.querySelector('.theme-shuffle__options').classList.contains('settings-dimmed')).toBe(false);
  });
});
