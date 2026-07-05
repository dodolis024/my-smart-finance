import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useSplitGroups } from '@/hooks/useSplitGroups';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/lib/supabase';
import SplitGroupCard from '@/components/split/SplitGroupCard';
import SplitGroupDetail from '@/components/split/SplitGroupDetail';
import CreateGroupModal from '@/components/split/CreateGroupModal';

const SPLIT_CURRENCIES = ['TWD', 'USD', 'JPY', 'KRW', 'EUR', 'GBP'];

// Module-level cache for exchange rates
let cachedRates = null;

// ── 分帳主頁（/split）────────────────────────────────────────────────────────
export default function SplitPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { groups, loading, fetchGroups, createGroup, updateGroup, archiveGroup, unarchiveGroup, deleteGroup, addMember, updateMemberName, removeMember } = useSplitGroups();
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [rates, setRates] = useState(() => cachedRates || { TWD: 1 });
  const toast = useToast();
  const { confirm } = useConfirm();

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  useEffect(() => {
    if (selectedGroup) {
      const updated = groups.find(g => g.id === selectedGroup.id);
      if (updated && updated !== selectedGroup) setSelectedGroup(updated);
    }
  }, [groups, selectedGroup]);

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

  const activeGroups = groups.filter(g => !g.archived_at);
  const archivedGroups = groups.filter(g => g.archived_at);

  return (
    <div className="split-page">
      {selectedGroup ? (
        <>
          <div className="split-page__header">
            <button type="button" className="split-page__back-btn" onClick={() => setSelectedGroup(null)}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
              {t('split.back')}
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
          <div className="split-page__header">
            <button type="button" className="split-page__back-btn" onClick={() => navigate('/')}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
              {t('split.back')}
            </button>
            <h1 className="split-page__title">Split</h1>
          </div>

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
                      onClick={() => setSelectedGroup(g)}
                      onDelete={handleDeleteGroup}
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
                          onClick={() => setSelectedGroup(g)}
                          onDelete={handleDeleteGroup}
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
            currencies={SPLIT_CURRENCIES}
          />
        </>
      )}
    </div>
  );
}
