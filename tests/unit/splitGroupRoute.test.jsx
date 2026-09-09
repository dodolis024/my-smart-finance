import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, matchRoutes } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 分帳群組要記在網址上：重新整理停留在原本的群組，而不是退回群組總覽。
 * 這件事只有「網址 → 畫面」這條路徑保證得了，所以測的是路由而非元件狀態。
 */

const groups = [
  { id: 'g1', name: '日本旅行', currency: 'TWD', split_members: [] },
  { id: 'g2', name: '室友共同開銷', currency: 'TWD', split_members: [] },
];

let mockGroups = groups;
let mockLoading = false;

vi.mock('@/lib/supabase', () => ({
  supabase: {
    // 都回空的：匯率／幣別不是這裡的重點，也免得非同步 setState 落在 act 之外
    from: () => ({ select: () => Promise.resolve({ data: null }) }),
    rpc: () => Promise.resolve({ data: [], error: null }),
  },
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

vi.mock('@/hooks/useSplitGroups', () => ({
  useSplitGroups: () => ({
    groups: mockGroups,
    loading: mockLoading,
    fetchGroups: () => {},
    createGroup: () => {}, updateGroup: () => {}, archiveGroup: () => {}, unarchiveGroup: () => {},
    togglePin: () => {}, deleteGroup: () => {}, addMember: () => {}, updateMemberName: () => {}, removeMember: () => {},
  }),
}));

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ success: () => {}, error: () => {} }),
}));

vi.mock('@/contexts/ConfirmContext', () => ({
  useConfirm: () => ({ confirm: () => Promise.resolve(true) }),
}));

// 群組內頁本身不是這裡的重點，換成看得出「開了哪一個群組」的替身
vi.mock('@/components/split/SplitGroupDetail', () => ({
  default: ({ group }) => createElement('div', { 'data-testid': 'group-detail' }, group.name),
}));

const { default: SplitPage } = await import('@/pages/SplitPage');
const { LanguageProvider } = await import('@/contexts/LanguageContext');

let container;
let root;

function renderAt(path) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      createElement(LanguageProvider, null,
        createElement(MemoryRouter, { initialEntries: [path] },
          createElement(Routes, null,
            createElement(Route, { path: '/split', element: createElement(SplitPage) }),
            createElement(Route, { path: '/split/:groupId', element: createElement(SplitPage) }),
          )
        )
      )
    );
  });
}

beforeEach(() => {
  mockGroups = groups;
  mockLoading = false;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('分帳群組的網址', () => {
  it('直接開 /split/:groupId（＝在群組內重新整理）會停在那個群組', () => {
    renderAt('/split/g2');
    expect(container.querySelector('[data-testid="group-detail"]')?.textContent).toBe('室友共同開銷');
    expect(container.querySelector('.split-group-list')).toBeNull();
  });

  it('/split 仍然是群組總覽', () => {
    renderAt('/split');
    expect(container.querySelector('[data-testid="group-detail"]')).toBeNull();
    expect(container.querySelector('.split-group-list')).not.toBeNull();
  });

  it('群組清單還沒載入完不會先閃一下總覽', () => {
    mockGroups = [];
    mockLoading = true;
    renderAt('/split/g2');
    expect(container.querySelector('.split-group-list')).toBeNull();
    expect(container.querySelector('.split-loading')).not.toBeNull();
  });

  it('點群組卡片會把網址換成該群組', () => {
    renderAt('/split');
    act(() => {
      container.querySelector('.split-group-list').firstElementChild.click();
    });
    expect(container.querySelector('[data-testid="group-detail"]')).not.toBeNull();
  });

  it('/split/join/:code 不會被當成群組 id', () => {
    const routes = [{ path: '/split' }, { path: '/split/join/:code?' }, { path: '/split/:groupId' }];
    expect(matchRoutes(routes, '/split/join/ABCD').at(-1).route.path).toBe('/split/join/:code?');
    expect(matchRoutes(routes, '/split/join').at(-1).route.path).toBe('/split/join/:code?');
    expect(matchRoutes(routes, '/split/g1').at(-1).route.path).toBe('/split/:groupId');
  });
});
