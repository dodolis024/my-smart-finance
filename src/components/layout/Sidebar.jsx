import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useNavActions } from '@/contexts/NavActionsContext';

const STORAGE_KEY = 'sidebar-collapsed';

export default function Sidebar({ hasChangelogUnread = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { userInfo, signOut } = useAuth();
  const { confirm } = useConfirm();
  const { dispatch } = useNavActions();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === 'true'; } catch { return false; }
  });
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, collapsed); } catch {}
  }, [collapsed]);

  const currentPath = location.pathname;

  const handleLogout = async () => {
    const confirmed = await confirm('確定要登出嗎？');
    if (!confirmed) return;
    await signOut();
  };

  const isGoogle = userInfo?.provider === 'google' && userInfo?.avatarUrl;
  const initial = userInfo?.email ? userInfo.email[0].toUpperCase() : '?';

  return (
    <nav className={`app-sidebar${collapsed ? ' is-collapsed' : ''}`} aria-label="主導覽">
      <div className="app-sidebar__header">
        {!collapsed && <span className="app-sidebar__title">My Smart Finance</span>}
        <button
          type="button"
          className="app-sidebar__toggle"
          onClick={() => setCollapsed(c => !c)}
          aria-label={collapsed ? '展開側欄' : '收合側欄'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            {collapsed ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            )}
          </svg>
        </button>
      </div>

      <div className="app-sidebar__nav">
        {/* Home */}
        <button
          type="button"
          className={`app-sidebar__item${currentPath === '/' ? ' is-active' : ''}`}
          onClick={() => navigate('/')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="app-sidebar__icon">
            <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
          </svg>
          {!collapsed && <span>Home</span>}
        </button>

        {/* Split */}
        <button
          type="button"
          className={`app-sidebar__item${currentPath.startsWith('/split') ? ' is-active' : ''}`}
          onClick={() => navigate('/split')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="app-sidebar__icon">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
          </svg>
          {!collapsed && <span>Split</span>}
        </button>

        <div className="app-sidebar__divider" />

        {/* 更新紀錄 */}
        <button
          type="button"
          className="app-sidebar__item"
          onClick={() => dispatch('openChangelog')}
        >
          <span className="app-sidebar__icon-wrap">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="app-sidebar__icon">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
            </svg>
            {hasChangelogUnread && <span className="changelog-unread-dot" />}
          </span>
          {!collapsed && <span>Change log</span>}
        </button>

        {/* 設定 */}
        <button
          type="button"
          className="app-sidebar__item"
          onClick={() => dispatch('openSettings')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="app-sidebar__icon">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
          {!collapsed && <span>設定</span>}
        </button>
      </div>

      {/* Bottom: Avatar + user info */}
      {userInfo && (
        <div className="app-sidebar__footer">
          <div className="app-sidebar__divider" />
          <div className="app-sidebar__user">
            <button className="app-sidebar__avatar" onClick={handleLogout} title="登出">
              <span className="user-avatar-inner">
                {isGoogle && !imgError ? (
                  <img src={userInfo.avatarUrl} alt="User Avatar" onError={() => setImgError(true)} />
                ) : (
                  initial
                )}
              </span>
            </button>
            {!collapsed && (
              <div className="app-sidebar__user-info">
                <span className="app-sidebar__user-email">{userInfo.email || '—'}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
