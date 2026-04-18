import { useRef, useState, useEffect } from 'react';
import Modal from './Modal';
import { parseChangelogMarkdown } from '@/lib/utils';
import { useScrollbarOnScroll } from '@/hooks/useScrollbarOnScroll';
import { useLanguage } from '@/contexts/LanguageContext';

export default function ChangelogModal({ isOpen, onClose }) {
  const { t, lang } = useLanguage();
  const contentRef = useRef(null);
  const [entries, setEntries] = useState([]);
  useScrollbarOnScroll(contentRef, isOpen);

  useEffect(() => {
    if (!isOpen) return;
    fetch(`${import.meta.env.BASE_URL}CHANGELOG.${lang}.md`, { cache: 'no-cache' })
      .then(r => r.text())
      .then(text => setEntries(parseChangelogMarkdown(text)))
      .catch(err => console.error('[Changelog] fetch failed:', err));
  }, [isOpen, lang]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="changelog-modal" titleId="changelog-modal-title">
      <div className="changelog-modal__backdrop" onClick={onClose} />
      <div className="changelog-modal__dialog" onClick={(e) => e.stopPropagation()}>
        <div className="changelog-modal__header">
          <h2 id="changelog-modal-title" className="changelog-modal__title">{t('changelog.title')}</h2>
          <button type="button" className="changelog-modal__close" aria-label={t('changelog.close')} onClick={onClose}>×</button>
        </div>
        <div ref={contentRef} className="changelog-modal__body scrollbar-on-scroll">
          <div className="changelog-content">
            {entries.length === 0 ? (
              <p className="changelog-empty">{t('changelog.loading')}</p>
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
