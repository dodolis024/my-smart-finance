import { useState, useEffect, useRef } from 'react';
import Modal from './Modal';
import { parseChangelogMarkdown } from '@/lib/utils';
import { useScrollbarOnScroll } from '@/hooks/useScrollbarOnScroll';

const CHANGELOG_FALLBACK = [
  {
    version: '1.1.0',
    date: 'Feb-23 2026',
    changes: ['新增更新紀錄功能，可於更多選項中查看版本紀錄'],
  },
  {
    version: '1.0.0',
    date: 'Jan-15 2026',
    changes: ['初版上線', '交易記帳、類別與帳戶管理', '今日簽到、記帳日曆', '圖表分析、多幣別支援', '交易篩選、手機版優化'],
  },
];

// Module-level cache
let cachedEntries = null;

export default function ChangelogModal({ isOpen, onClose }) {
  const [entries, setEntries] = useState(() => cachedEntries || []);
  const contentRef = useRef(null);
  useScrollbarOnScroll(contentRef, isOpen);

  useEffect(() => {
    if (!isOpen || cachedEntries) return;
    const load = async () => {
      try {
        const url = new URL('CHANGELOG.md', window.location.href).href;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to fetch');
        const text = await res.text();
        const parsed = parseChangelogMarkdown(text);
        const result = parsed.length > 0 ? parsed : CHANGELOG_FALLBACK;
        cachedEntries = result;
        setEntries(result);
      } catch {
        cachedEntries = CHANGELOG_FALLBACK;
        setEntries(CHANGELOG_FALLBACK);
      }
    };
    load();
  }, [isOpen]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="changelog-modal" titleId="changelog-modal-title">
      <div className="changelog-modal__backdrop" onClick={onClose} />
      <div className="changelog-modal__dialog" onClick={(e) => e.stopPropagation()}>
        <div className="changelog-modal__header">
          <h2 id="changelog-modal-title" className="changelog-modal__title">更新紀錄</h2>
          <button type="button" className="changelog-modal__close" aria-label="關閉" onClick={onClose}>×</button>
        </div>
        <div ref={contentRef} className="changelog-modal__body scrollbar-on-scroll">
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
      </div>
    </Modal>
  );
}
