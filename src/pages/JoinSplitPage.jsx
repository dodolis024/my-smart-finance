import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/contexts/ToastContext';
import { useSplitGroups } from '@/hooks/useSplitGroups';

export default function JoinPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const { getGroupByCode, linkSelfToMember, joinGroupAsNewMember, fetchGroups } = useSplitGroups();

  const [inputCode, setInputCode] = useState(code || '');
  const [groupInfo, setGroupInfo] = useState(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null); // member id or 'new'
  const [newName, setNewName] = useState('');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');

  // URL 帶代碼時自動搜尋
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
        if (!data) { setError('找不到此代碼，請確認是否正確。'); return; }
        setGroupInfo(data);
      })
      .catch(() => setError('查詢失敗，請稍後再試。'))
      .finally(() => setSearching(false));
  }, [code, getGroupByCode]);

  const handleSearch = async (c) => {
    const trimmed = (c || inputCode).trim().toUpperCase();
    if (!trimmed) return;
    setSearching(true);
    setError('');
    setGroupInfo(null);
    setSelected(null);
    try {
      const data = await getGroupByCode(trimmed);
      if (!data) { setError('找不到此代碼，請確認是否正確。'); return; }
      setGroupInfo(data);
    } catch {
      setError('查詢失敗，請稍後再試。');
    } finally {
      setSearching(false);
    }
  };

  const handleJoin = async () => {
    if (!selected) { setError('請選擇你是哪位成員'); return; }
    if (selected === 'new' && !newName.trim()) { setError('請填寫你的名稱'); return; }
    setJoining(true);
    setError('');
    try {
      if (selected === 'new') {
        await joinGroupAsNewMember(inputCode.trim().toUpperCase(), newName.trim());
      } else {
        await linkSelfToMember(selected);
      }
      toast.success('已成功加入群組！');
      navigate('/split');
    } catch (err) {
      setError(err.message || '加入失敗，請稍後再試。');
    } finally {
      setJoining(false);
    }
  };

  // 用 is_self 布林欄位取代直接暴露 user_id UUID
  const alreadyLinked = groupInfo?.members?.find(m => m.is_self);
  useEffect(() => {
    if (alreadyLinked) navigate('/split');
  }, [alreadyLinked, navigate]);

  if (alreadyLinked) return null;

  return (
    <div className="split-join-page">
      <div className="split-join-page__card">
        <p className="split-join-page__title">加入群組</p>
        <p className="split-join-page__subtitle">輸入邀請代碼或點擊邀請連結加入</p>

        <div className="split-modal__field">
          <input
            className={`split-modal__input split-join-page__code-input`}
            placeholder="輸入代碼"
            value={inputCode}
            onChange={e => setInputCode(e.target.value.toUpperCase())}
            maxLength={6}
          />
        </div>
        <button type="button" className="split-btn-primary" onClick={() => handleSearch()} disabled={searching || !inputCode.trim()} style={{ marginBottom: '0.75rem' }}>
          {searching ? '搜尋中...' : '搜尋群組'}
        </button>

        {groupInfo && (
          <div className="split-join-page__group-info">
            <p className="split-join-page__group-name">{groupInfo.name}</p>
            <p className="split-join-page__members-label">請選擇你是哪位成員：</p>
            {groupInfo.members?.map(m => {
              const isTaken = m.is_linked && !m.is_self;
              return (
                <div
                  key={m.id}
                  className={`split-join-page__member-option${selected === m.id ? ' is-selected' : ''}${isTaken ? ' is-taken' : ''}`}
                  onClick={() => !isTaken && setSelected(m.id)}
                >
                  {m.name}
                  {isTaken && <span style={{ fontSize: '0.75rem', marginLeft: 'auto', opacity: 0.6 }}>已連結</span>}
                </div>
              );
            })}
            <div
              className={`split-join-page__member-option${selected === 'new' ? ' is-selected' : ''}`}
              onClick={() => setSelected('new')}
            >
              ＋ 我不在名單上，新增自己
            </div>
            {selected === 'new' && (
              <input
                className="split-modal__input"
                placeholder="你的名稱"
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
            {joining ? '加入中...' : '加入群組'}
          </button>
        )}

        <button type="button" className="split-btn-secondary" onClick={() => navigate('/split')} style={{ marginTop: '0.5rem' }}>
          返回
        </button>
      </div>
    </div>
  );
}
