import { useAuth } from '@/contexts/AuthContext';

function MemberAvatar({ member }) {
  const { userInfo } = useAuth();
  const isMe = member.user_id && userInfo && member.user_id === userInfo.id;
  const initial = member.name?.[0]?.toUpperCase() || '?';

  if (isMe && userInfo?.provider === 'google' && userInfo?.avatarUrl) {
    return (
      <span className="split-member-avatar" title={member.name}>
        <img src={userInfo.avatarUrl} alt={member.name} />
      </span>
    );
  }
  return (
    <span className="split-member-avatar" title={member.name}>
      {initial}
    </span>
  );
}

export default function SplitGroupCard({ group, onClick }) {
  const totalAmount = 0; // 未來可加總費用
  const memberCount = group.split_members?.length || 0;

  return (
    <div className="split-group-card" onClick={onClick} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onClick()}>
      <p className="split-group-card__name">{group.name}</p>
      <div className="split-group-card__meta">
        <span>{memberCount} 人</span>
        <span>{group.currency || 'TWD'}</span>
      </div>
      {group.split_members?.length > 0 && (
        <div className="split-group-card__members">
          {group.split_members.slice(0, 6).map(m => (
            <MemberAvatar key={m.id} member={m} />
          ))}
          {group.split_members.length > 6 && (
            <span className="split-member-avatar" style={{ fontSize: '0.65rem' }}>
              +{group.split_members.length - 6}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
