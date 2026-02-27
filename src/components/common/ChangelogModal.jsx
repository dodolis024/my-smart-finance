import { useState, useEffect, useRef } from 'react';
import Modal from './Modal';
import { parseChangelogMarkdown } from '@/lib/utils';
import { useScrollbarOnScroll } from '@/hooks/useScrollbarOnScroll';

const CHANGELOG_FALLBACK = [
  {
    version: '1.1.0',
    date: 'Feb-23 2026',
    changes: ['新增更新日記（Change Log）功能，可於更多選項中查看版本紀錄'],
  },
  {
    version: '1.0.0',
    date: 'Jan-15 2026',
    changes: ['初版上線', '交易記帳、類別與帳戶管理', '今日簽到、記帳日曆', '圖表分析、多幣別支援', '交易篩選、手機版優化'],
  },
];

export default function ChangelogModal({ isOpen, onClose }) {
  const [entries, setEntries] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const dialogRef = useRef(null);
  useScrollbarOnScroll(dialogRef, isOpen);

  useEffect(() => {
    if (!isOpen || loaded) return;
    const load = async () => {
      try {
        const url = new URL('CHANGELOG.md', window.location.href).href;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to fetch');
        const text = await res.text();
        const parsed = parseChangelogMarkdown(text);
        setEntries(parsed.length > 0 ? parsed : CHANGELOG_FALLBACK);
      } catch {
        setEntries(CHANGELOG_FALLBACK);
      }
      setLoaded(true);
    };
    load();
  }, [isOpen, loaded]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="changelog-modal">
      <div className="changelog-modal__backdrop" onClick={onClose} />
      <div ref={dialogRef} className="changelog-modal__dialog scrollbar-on-scroll" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="changelog-modal__close" aria-label="關閉" onClick={onClose}>×</button>
        <h2 className="changelog-modal__title">Change Log</h2>
        <div className="changelog-content">
          {entries.length === 0 ? (
            <p className="changelog-empty">載入中...</p>
          ) : (
            entries.map(({ version, date, changes }) => (
              <div key={version} className="changelog-entry">
                <div className="changelog-entry__header">
                  <span className="changelog-entry__version">v{version}</span>
                  <span className="changelog-entry__date">{date}</span>
                </div>
                <ul className="changelog-entry__list">
                  {changes.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
