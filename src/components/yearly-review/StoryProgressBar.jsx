export default function StoryProgressBar({ total, current, onJump }) {
  return (
    <div className="story-progress-bar" role="tablist" aria-label="卡片進度">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          role="tab"
          aria-selected={i === current}
          className={[
            'story-progress-bar__segment',
            i < current  ? 'story-progress-bar__segment--passed' : '',
            i === current ? 'story-progress-bar__segment--active' : '',
          ].join(' ')}
          onClick={() => onJump(i)}
        />
      ))}
    </div>
  );
}
