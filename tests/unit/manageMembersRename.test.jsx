import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 管理成員彈窗的改名門檻要和 split_members_update policy 一致：
 * 群主能改沒連結帳號的成員、本人能改自己，其他組合連點都點不到。
 * 非群主在 RLS 擋下時 PostgREST 回「成功、0 列」，畫面若放他編輯就會出現假成功，
 * 所以這條守的是「不該可編輯的就不能有可編輯的樣式與點擊」。
 */

const { default: ManageMembersModal } = await import('@/components/split/ManageMembersModal');
const { LanguageProvider } = await import('@/contexts/LanguageContext');

const members = [
  { id: 'm1', name: '我', user_id: 'u1' },
  { id: 'm2', name: '小美', user_id: null },
  { id: 'm3', name: '阿強', user_id: 'u3' },
];

let container, root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

function render({ isOwner }) {
  act(() => {
    root.render(createElement(LanguageProvider, null, createElement(ManageMembersModal, {
      isOpen: true,
      onClose: () => {},
      members,
      currentUserId: 'u1',
      isOwner,
      onAddMembers: async () => {},
      onUpdateMemberName: async () => {},
    })));
  });
}

const nameEl = (name) => [...container.querySelectorAll('.split-modal__member-name')].find((el) => el.textContent === name);
const editable = (name) => nameEl(name).classList.contains('split-modal__member-name--editable');
const click = (el) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

describe('群主', () => {
  it('能改自己與未連結的成員，不能改別人已連結的名字', () => {
    render({ isOwner: true });
    expect(editable('我')).toBe(true);
    expect(editable('小美')).toBe(true);
    expect(editable('阿強')).toBe(false);
  });

  it('點未連結成員會進入編輯框，而且看不到群主專屬的說明', () => {
    render({ isOwner: true });
    click(nameEl('小美'));
    expect(container.querySelector('.split-modal__input--inline-edit')).not.toBeNull();
    expect(container.querySelector('.split-modal__hint')).toBeNull();
  });
});

describe('非群主', () => {
  it('只能改自己；點未連結成員不會進入編輯框', () => {
    render({ isOwner: false });
    expect(editable('我')).toBe(true);
    expect(editable('小美')).toBe(false);
    expect(editable('阿強')).toBe(false);
    click(nameEl('小美'));
    expect(container.querySelector('.split-modal__input--inline-edit')).toBeNull();
  });

  it('有未連結成員時看得到「只有群主能改名」的說明', () => {
    render({ isOwner: false });
    const hint = container.querySelector('.split-modal__hint');
    expect(hint).not.toBeNull();
    expect(hint.textContent).toContain('群主');
  });
});
