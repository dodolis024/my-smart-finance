import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * 類別管理的展開入口與新增列。
 *
 * 新類別一律加在清單最後面，所以新增入口放在清單最下面：在哪裡輸入，就出現在哪裡。
 * 標題列右側只放「數量 ⌄」，不再有「新增」按鈕。
 */

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// 手機版一次只展開一區，靠 matchMedia 判斷；jsdom 沒有這個 API
window.matchMedia = window.matchMedia || ((query) => ({
  matches: false, media: query, addEventListener() {}, removeEventListener() {},
}));

vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k) => k, lang: 'zh' }) }));

const CategoryManager = (await import('@/components/settings/CategoryManager')).default;

let container, root, onAdd;
beforeEach(() => {
  onAdd = vi.fn().mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const render = (props = {}) => act(() => {
  root.render(createElement(CategoryManager, {
    expenseCategories: ['餐飲', '交通'],
    incomeCategories: ['薪水'],
    onAdd, onRename: vi.fn(), onDelete: vi.fn(), onReorderTo: vi.fn(),
    loading: false, confirm: vi.fn(), onError: vi.fn(),
    ...props,
  }));
});
// 群組順序：支出、收入
const groups = () => [...container.querySelectorAll('.category-group')];
const click = (el) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
// React 的受控 input 要用原生 setter 改值，再發 input 事件，onChange 才收得到
const typeInto = (input, value) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

describe('CategoryManager 標題列', () => {
  it('右側顯示類別數量，沒有舊的「新增」按鈕', () => {
    render();

    groups().forEach((group) => {
      const header = group.querySelector('.disclosure-row');
      expect(header.textContent).toContain('settings.category.count');
      expect(header.querySelector('[aria-expanded]').getAttribute('aria-expanded')).toBe('false');
    });
    expect(container.querySelector('.btn-add-category')).toBeNull();
  });

  it('預設收合，點標題列才展開清單', () => {
    render();
    expect(container.querySelector('.category-list')).toBeNull();

    click(groups()[0].querySelector('.disclosure-row'));
    expect(groups()[0].querySelector('.category-list')).not.toBeNull();
    expect(groups()[1].querySelector('.category-list')).toBeNull();
  });
});

describe('清單最下面的新增列', () => {
  it('展開後，新增列排在清單最後面', () => {
    render();
    click(groups()[0].querySelector('.disclosure-row'));

    const body = groups()[0].querySelector('.disclosure-row').nextElementSibling;
    expect(body.lastElementChild.classList.contains('category-add-row')).toBe(true);
    expect(body.querySelectorAll('.category-item')).toHaveLength(2);
  });

  it('點新增列換成輸入框，按確認會用去掉空白的名稱呼叫 onAdd', async () => {
    render();
    click(groups()[1].querySelector('.disclosure-row'));
    click(groups()[1].querySelector('.category-add-row'));

    const editing = groups()[1].querySelector('.category-add-editing');
    expect(editing).not.toBeNull();
    expect(groups()[1].querySelector('.category-add-row')).toBeNull();

    typeInto(editing.querySelector('input'), '  獎金 ');
    const confirm = [...editing.querySelectorAll('button')].find((b) => b.textContent === 'common.confirm');
    await act(async () => confirm.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(onAdd).toHaveBeenCalledWith('income', '獎金');
    // 送出後回到新增列
    expect(groups()[1].querySelector('.category-add-editing')).toBeNull();
    expect(groups()[1].querySelector('.category-add-row')).not.toBeNull();
  });

  it('類別數量是 0 時，展開後只有新增列', () => {
    render({ incomeCategories: [] });
    click(groups()[1].querySelector('.disclosure-row'));

    expect(groups()[1].querySelectorAll('.category-item')).toHaveLength(0);
    expect(groups()[1].querySelector('.category-add-row')).not.toBeNull();
  });
});
