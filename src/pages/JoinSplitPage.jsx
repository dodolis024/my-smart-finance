import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/contexts/ToastContext';
import { useSplitGroups } from '@/hooks/useSplitGroups';
import { useLanguage } from '@/contexts/LanguageContext';

export default function JoinPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { t } = useLanguage();
  const { user } = useAuth();
  const { getGroupByCode, linkSelfToMember, joinGroupAsNewMember, fetchGroups } = useSplitGroups();

  const [inputCode, setInputCode] = useState(code || '');
  const [groupInfo, setGroupInfo] = useState(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [newName, setNewName] = useState('');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!code) return;
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setSearching(true);
    setError('');
    setGroupInfo(null);
    setSelected(null);
    getGroupByCode(trimmed)
      .then(data => {
        if (!data) { setError(t('split.joinPage.notFound')); return; }
        setGroupInfo(data);
      })
      .catch(() => setError(t('split.joinPage.searchFailed')))
      .finally(() => setSearching(false));
  }, [code, getGroupByCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = async (c) => {
    const trimmed = (c || inputCode).trim().toUpperCase();
    if (!trimmed) return;
    setSearching(true);
    setError('');
    setGroupInfo(null);
    setSelected(null);
    try {
      const data = await getGroupByCode(trimmed);
      if (!data) { setError(t('split.joinPage.notFound')); return; }
      setGroupInfo(data);
    } catch {
      setError(t('split.joinPage.searchFailed'));
    } finally {
      setSearching(false);
    }
  };

  const handleJoin = async () => {
    if (!selected) { setError(t('split.joinPage.noMemberSelected')); return; }
    if (selected === 'new' && !newName.trim()) { setError(t('split.joinPage.noNameEntered')); return; }
    setJoining(true);
    setError('');
    try {
      if (selected === 'new') {
        await joinGroupAsNewMember(inputCode.trim().toUpperCase(), newName.trim());
      } else {
        await linkSelfToMember(selected);
      }
      toast.success(t('split.joinPage.joinSuccess'));
      navigate('/split');
    } catch (err) {
      setError(err.message || t('split.joinPage.joinFailed'));
    } finally {
      setJoining(false);
    }
  };

  const alreadyLinked = groupInfo?.members?.find(m => m.is_self);
  useEffect(() => {
    if (alreadyLinked) navigate('/split');
  }, [alreadyLinked, navigate]);

  if (alreadyLinked) return null;

  return (
    <div className="split-join-page">
      <div className="split-join-page__card">
        <p className="split-join-page__title">{t('split.joinPage.title')}</p>
        <p className="split-join-page__subtitle">{t('split.joinPage.subtitle')}</p>

        <div className="split-modal__field">
          <input
            className="split-modal__input split-join-page__code-input"
            placeholder={t('split.joinPage.codeInputPlaceholder')}
            value={inputCode}
            onChange={e => setInputCode(e.target.value.toUpperCase())}
            maxLength={6}
          />
        </div>
        <button type="button" className="split-btn-primary" onClick={() => handleSearch()} disabled={searching || !inputCode.trim()} style={{ marginBottom: '0.75rem' }}>
          {searching ? t('split.joinPage.searching') : t('split.joinPage.searchBtn')}
        </button>

        {groupInfo && (
          <div className="split-join-page__group-info">
            <p className="split-join-page__group-name">{groupInfo.name}</p>
            <p className="split-join-page__members-label">{t('split.joinPage.selectMemberLabel')}</p>
            {groupInfo.members?.map(m => {
              const isTaken = m.is_linked && !m.is_self;
              return (
                <div
                  key={m.id}
                  className={`split-join-page__member-option${selected === m.id ? ' is-selected' : ''}${isTaken ? ' is-taken' : ''}`}
                  onClick={() => !isTaken && setSelected(m.id)}
                >
                  {m.name}
                  {isTaken && <span style={{ fontSize: '0.75rem', marginLeft: 'auto', opacity: 0.6 }}>{t('split.joinPage.alreadyLinked')}</span>}
                </div>
              );
            })}
            <div
              className={`split-join-page__member-option${selected === 'new' ? ' is-selected' : ''}`}
              onClick={() => setSelected('new')}
            >
              {t('split.joinPage.addSelf')}
            </div>
            {selected === 'new' && (
              <input
                className="split-modal__input"
                placeholder={t('split.joinPage.yourNamePlaceholder')}
                value={newName}
                onChange={e => setNewName(e.target.value)}
                style={{ marginTop: '0.5rem' }}
              />
            )}
          </div>
        )}

        {error && <p className="split-modal__error" style={{ textAlign: 'center' }}>{error}</p>}

        {groupInfo && (
          <button type="button" className="split-btn-primary" onClick={handleJoin} disabled={joining} style={{ marginTop: '0.75rem' }}>
            {joining ? t('split.joinPage.joining') : t('split.joinPage.joinBtn')}
          </button>
        )}

        <button type="button" className="split-btn-secondary" onClick={() => navigate('/split')} style={{ marginTop: '0.5rem' }}>
          {t('split.joinPage.back')}
        </button>
      </div>
    </div>
  );
}
