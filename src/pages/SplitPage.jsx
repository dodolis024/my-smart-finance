import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useSplitGroups } from '@/hooks/useSplitGroups';
import { supabase } from '@/lib/supabase';
import SplitGroupCard from '@/components/split/SplitGroupCard';
import SplitGroupDetail from '@/components/split/SplitGroupDetail';
import CreateGroupModal from '@/components/split/CreateGroupModal';

const SPLIT_CURRENCIES = ['TWD', 'USD', 'JPY', 'EUR', 'GBP'];

// Module-level cache for exchange rates
let cachedRates = null;

// ── 分帳主頁（/split）────────────────────────────────────────────────────────
export default function SplitPage() {
  const navigate = useNavigate();
  const { groups, loading, fetchGroups, createGroup, updateGroup, deleteGroup, addMember, removeMember } = useSplitGroups();
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [rates, setRates] = useState(() => cachedRates || { TWD: 1 });
  const toast = useToast();
  const { confirm } = useConfirm();

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  // 當 groups 更新時，同步 selectedGroup 的資料（避免快照過期）
  useEffect(() => {
    if (selectedGroup) {
      const updated = groups.find(g => g.id === selectedGroup.id);
      if (updated && updated !== selectedGroup) setSelectedGroup(updated);
    }
  }, [groups, selectedGroup]);

  // 載入匯率（有 cache 就跳過）
  useEffect(() => {
    if (cachedRates) return;
    supabase
      .from('exchange_rates')
      .select('currency_code, rate')
      .in('currency_code', SPLIT_CURRENCIES)
      .then(({ data }) => {
        if (!data) return;
        const obj = { TWD: 1 };
        data.forEach(r => { obj[r.currency_code] = Number(r.rate); });
        cachedRates = obj;
        setRates(obj);
      });
  }, []);

  const handleCreate = async (data) => {
    const group = await createGroup(data);
    toast.success('群組已建立！');
    return group;
  };


  return (
    <div className="split-page">
      {selectedGroup ? (
        <>
          <div className="split-page__header">
            <button type="button" className="split-page__back-btn" onClick={() => setSelectedGroup(null)}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
              返回
            </button>
            <h1 className="split-page__title">Split</h1>
          </div>
          <SplitGroupDetail
            group={selectedGroup}
            onBack={() => setSelectedGroup(null)}
            rates={rates}
            currencies={SPLIT_CURRENCIES}
            onAddMember={async (groupId, name) => {
              try {
                await addMember(groupId, name);
                toast.success('成員已新增！');
              } catch {
                toast.error('新增失敗，請稍後再試。');
              }
            }}
            onRemoveMember={async (memberId) => {
              try {
                await removeMember(selectedGroup.id, memberId);
                toast.success('成員已移除。');
              } catch {
                toast.error('移除失敗，請稍後再試。');
              }
            }}
            onUpdateGroup={updateGroup}
          />
        </>
      ) : (
        <>
          <div className="split-page__header">
            <button type="button" className="split-page__back-btn" onClick={() => navigate('/')}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
              返回
            </button>
            <h1 className="split-page__title">Split</h1>
          </div>

          {loading ? (
            <p className="split-loading">載入中...</p>
          ) : (
            <>
              {groups.length === 0 ? (
                <p className="split-group-list__empty">還沒有分帳群組，建立第一個吧！</p>
              ) : (
                <div className="split-group-list">
                  {groups.map(g => (
                    <SplitGroupCard
                      key={g.id}
                      group={g}
                      onClick={() => setSelectedGroup(g)}
                      onDelete={async (groupId) => {
                        const ok = await confirm('確定要刪除這個群組嗎？所有費用都會一併刪除。', { danger: true });
                        if (!ok) return;
                        try {
                          await deleteGroup(groupId);
                          toast.success('群組已刪除。');
                        } catch {
                          toast.error('刪除失敗，請稍後再試。');
                        }
                      }}
                    />
                  ))}
                </div>
              )}
              <div className="split-group-list__actions">
                <button type="button" className="split-btn-primary" onClick={() => setCreateOpen(true)}>
                  ＋ 新增群組
                </button>
                <button type="button" className="split-btn-secondary" onClick={() => navigate('/split/join/')}>
                  加入群組
                </button>
              </div>
            </>
          )}

          <CreateGroupModal
            isOpen={createOpen}
            onClose={() => setCreateOpen(false)}
            onCreate={handleCreate}
            currencies={SPLIT_CURRENCIES}
          />
        </>
      )}
    </div>
  );
}

