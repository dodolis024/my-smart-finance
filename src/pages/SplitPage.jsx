import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useSplitGroups } from '@/hooks/useSplitGroups';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { loadRates, loadRatesSavedAt, saveRates } from '@/lib/offlineCache';
import SplitGroupCard from '@/components/split/SplitGroupCard';
import SplitGroupDetail from '@/components/split/SplitGroupDetail';
import CreateGroupModal from '@/components/split/CreateGroupModal';

// 幣別下拉選項排序：常用幣別優先，其餘照字母序（與個人帳本一致）
const PREFERRED_ORDER = ['TWD', 'USD', 'JPY', 'KRW', 'EUR', 'GBP'];

// 幣別清單很少變，module-level 快取整個 session 沿用
let cachedCurrencies = null;
// 匯率與主畫面共用 offlineCache 那份（含存檔時間）。凍結匯率上線後這裡只剩
// 「換算成群組結算幣別」一個用途，但 PWA 常開好幾天，超過一天就重抓
const RATES_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const initialRates = () => ({ TWD: 1, ...(loadRates() || {}) });

// ── 分帳主頁（/split）────────────────────────────────────────────────────────
export default function SplitPage() {
  const navigate = useNavigate();
  const { groupId } = useParams();
  const { t } = useLanguage();
  const { user } = useAuth();
  const { groups, loading, fetchGroups, createGroup, updateGroup, archiveGroup, unarchiveGroup, togglePin, deleteGroup, addMember, updateMemberName, removeMember } = useSplitGroups();
  const [createOpen, setCreateOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [rates, setRates] = useState(initialRates);
  const [currencies, setCurrencies] = useState(() => cachedCurrencies || PREFERRED_ORDER);
  const toast = useToast();
  const { confirm } = useConfirm();

  // 開啟中的群組由網址推導，而非元件狀態：重新整理後才會留在原本的群組。
  // 順帶讓群組資料更新（改名、成員異動）自動反映，不必再手動同步一份 state。
  const selectedGroup = groupId ? groups.find(g => g.id === groupId) || null : null;

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  // 網址指向的群組不存在（連結失效、群組已被刪除或退出）就退回總覽，
  // 否則畫面會卡在永遠等不到資料的載入中。
  useEffect(() => {
    if (groupId && !loading && !groups.some(g => g.id === groupId)) {
      navigate('/split', { replace: true });
    }
  }, [groupId, loading, groups, navigate]);

  // 進頁面與 App 切回前景時各檢查一次；還新鮮就不查，查失敗（離線）就沿用手上那份
  useEffect(() => {
    let cancelled = false;
    const refreshIfStale = () => {
      if (Date.now() - loadRatesSavedAt() < RATES_MAX_AGE_MS) return;
      supabase
        .from('exchange_rates')
        .select('currency_code, rate')
        .then(({ data }) => {
          if (cancelled || !Array.isArray(data) || data.length === 0) return;
          const obj = { TWD: 1 };
          data.forEach(r => { obj[String(r.currency_code).toUpperCase()] = Number(r.rate); });
          saveRates(obj);
          setRates(obj);
        });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshIfStale();
    };
    refreshIfStale();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  // 幣別選項改由匯率表動態決定（與個人帳本同一來源），免手動維護清單
  useEffect(() => {
    if (cachedCurrencies) return;
    supabase.rpc('get_available_currencies').then(({ data, error }) => {
      if (error || !Array.isArray(data) || data.length === 0) return;
      const upper = data.map(c => String(c).toUpperCase());
      upper.sort((a, b) => {
        const ai = PREFERRED_ORDER.indexOf(a);
        const bi = PREFERRED_ORDER.indexOf(b);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return a.localeCompare(b);
      });
      if (!upper.includes('TWD')) upper.unshift('TWD');
      cachedCurrencies = upper;
      setCurrencies(upper);
    });
  }, []);

  const handleCreate = async (data) => {
    const group = await createGroup(data);
    toast.success(t('split.groupCreated'));
    return group;
  };

  const handleDeleteGroup = async (groupId) => {
    const ok = await confirm(t('split.deleteGroupConfirm'), { danger: true });
    if (!ok) return;
    try {
      await deleteGroup(groupId);
      toast.success(t('split.groupDeleted'));
    } catch {
      toast.error(t('split.deleteGroupFailed'));
    }
  };

  const handleTogglePin = async (groupId) => {
    try {
      await togglePin(groupId);
    } catch {
      toast.error(t('split.pinFailed'));
    }
  };

  // 置頂排前面（多個置頂則後置頂的在上），其餘沿用查詢的 created_at 由新到舊。
  // 封存區不吃置頂：封存的語意就是「收起來不常看」，跟置頂衝突。
  const activeGroups = groups
    .filter(g => !g.archived_at)
    .sort((a, b) => {
      if (Boolean(a.pinned_at) !== Boolean(b.pinned_at)) return a.pinned_at ? -1 : 1;
      if (a.pinned_at && b.pinned_at) return b.pinned_at.localeCompare(a.pinned_at);
      return 0;
    });
  const archivedGroups = groups.filter(g => g.archived_at);

  // 群組內的返回鍵回到總覽，總覽的返回鍵離開分帳頁
  const header = (
    <div className="split-page__header">
      <button type="button" className="split-page__back-btn" onClick={() => navigate(groupId ? '/split' : '/')}>
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
        </svg>
        {t('split.back')}
      </button>
      <h1 className="split-page__title">{t('layout.split')}</h1>
    </div>
  );

  return (
    <div className="split-page">
      {groupId && !selectedGroup ? (
        // 直接開網址時群組清單還沒回來，先顯示載入中，別閃一下總覽
        <>
          {header}
          <p className="split-loading">{t('split.loading')}</p>
        </>
      ) : selectedGroup ? (
        <>
          {header}
          <SplitGroupDetail
            group={selectedGroup}
            onBack={() => navigate('/split')}
            rates={rates}
            currencies={currencies}
            onAddMember={async (id, name) => {
              try {
                await addMember(id, name);
                toast.success(t('split.memberAdded'));
              } catch {
                toast.error(t('split.addMemberFailed'));
              }
            }}
            onRemoveMember={async (memberId) => {
              try {
                await removeMember(selectedGroup.id, memberId);
                toast.success(t('split.memberRemoved'));
              } catch {
                toast.error(t('split.removeMemberFailed'));
              }
            }}
            onUpdateMemberName={async (memberId, newName) => {
              try {
                await updateMemberName(selectedGroup.id, memberId, newName);
                toast.success(t('split.memberNameUpdated'));
              } catch {
                toast.error(t('split.updateNameFailed'));
              }
            }}
            onUpdateGroup={updateGroup}
            onArchiveGroup={() => archiveGroup(selectedGroup.id)}
            onUnarchiveGroup={() => unarchiveGroup(selectedGroup.id)}
          />
        </>
      ) : (
        <>
          {header}

          {loading ? (
            <p className="split-loading">{t('split.loading')}</p>
          ) : (
            <>
              {groups.length === 0 ? (
                <p className="split-group-list__empty">{t('split.noGroups')}</p>
              ) : activeGroups.length > 0 && (
                <div className="split-group-list">
                  {activeGroups.map(g => (
                    <SplitGroupCard
                      key={g.id}
                      group={g}
                      onClick={() => navigate(`/split/${g.id}`)}
                      onDelete={g.owner_id === user?.id ? handleDeleteGroup : undefined}
                      onTogglePin={handleTogglePin}
                    />
                  ))}
                </div>
              )}
              <div className="split-group-list__actions">
                <button type="button" className="split-btn-primary" onClick={() => setCreateOpen(true)}>
                  {t('split.addGroup')}
                </button>
                <button type="button" className="split-btn-secondary" onClick={() => navigate('/split/join/')}>
                  {t('split.joinGroup')}
                </button>
              </div>

              {archivedGroups.length > 0 && (
                <div className="split-archived">
                  <button
                    type="button"
                    className={`split-archived-toggle${showArchived ? ' is-open' : ''}`}
                    onClick={() => setShowArchived(prev => !prev)}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="split-archived-toggle__chevron">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                    </svg>
                    {t('split.archivedSection', { n: archivedGroups.length })}
                  </button>
                  {showArchived && (
                    <div className="split-group-list">
                      {archivedGroups.map(g => (
                        <SplitGroupCard
                          key={g.id}
                          group={g}
                          archived
                          onClick={() => navigate(`/split/${g.id}`)}
                          onDelete={g.owner_id === user?.id ? handleDeleteGroup : undefined}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <CreateGroupModal
            isOpen={createOpen}
            onClose={() => setCreateOpen(false)}
            onCreate={handleCreate}
            currencies={currencies}
          />
        </>
      )}
    </div>
  );
}
