import { useState, useEffect, useRef, useId } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { useLanguage } from '@/contexts/LanguageContext';
import DisclosureToggle from '../DisclosureToggle';

const SHUFFLE_INTERVAL_IDS = ['open', 'daily', 'weekly', 'monthly'];

const THEME_OPTIONS = [
  { id: 'default', swatch: ['#b59c80', '#FAF9F6', '#dfdad3'] },
  { id: 'rose', swatch: ['#c06373', '#fcf8f5', '#efd0d9'] },
  { id: 'graphite', swatch: ['#656a6c', '#fdfeff', '#cfd6db'] },
  { id: 'dawn', swatch: ['#92a8d1', '#ffffff', '#f7cac9'] },
  { id: 'soda', swatch: ['#2e8cb8', '#f0fafd', '#95d7d3'] },
  { id: 'lavender', swatch: ['#8a7ebc', '#f9f7fb', '#ad9bd7'] },
  { id: 'sorbet', swatch: ['#ee9248', '#f0be3a', '#5ab0d4'] },
  { id: 'peach', swatch: ['#f99584', '#fffdfc', '#f4dbd6'] },
  { id: 'lime', swatch: ['#aec22a', '#fcfdf5', '#e0e6c0'] },
  { id: 'maple', swatch: ['#b3372d', '#f9f1ea', '#e8d4c4'] },
];

export default function ThemePanel() {
  const { theme, setTheme, shuffleEnabled, setShuffleEnabled, shuffleThemes, setShuffleThemes, shuffleInterval, setShuffleInterval } = useTheme();
  const { t } = useLanguage();
  const [open, setOpen] = useState({ shuffle: false });
  const shuffleRef = useRef(null);
  const shuffleBodyId = useId();
  const toggle = (k) => setOpen((s) => {
    const isMobile = window.matchMedia('(max-width: 600px)').matches;
    if (isMobile) {
      const allClosed = Object.fromEntries(Object.keys(s).map((key) => [key, false]));
      return { ...allClosed, [k]: !s[k] };
    }
    return { ...s, [k]: !s[k] };
  });
  useEffect(() => {
    if (!window.matchMedia('(max-width: 600px)').matches) return;
    const openKey = Object.keys(open).find((k) => open[k]);
    const el = openKey ? shuffleRef.current : null;
    const container = el?.closest('.usm__content');
    if (el && container) container.scrollTop = el.offsetTop - container.offsetTop;
  }, [open]);

  const toggleShuffleTheme = (id) => {
    if (shuffleThemes.includes(id)) {
      if (shuffleThemes.length <= 1) return;
      setShuffleThemes(shuffleThemes.filter(tid => tid !== id));
    } else {
      setShuffleThemes([...shuffleThemes, id]);
    }
  };

  return (
    <div className="usm-panel">
      <h3 className="settings-manage__section-title">{t('settings.theme.title')}</h3>

      <div className="theme-picker">
        {THEME_OPTIONS.map(({ id, swatch }) => (
          <button
            key={id}
            type="button"
            className={`theme-picker__item${theme === id ? ' is-active' : ''}`}
            onClick={() => setTheme(id)}
            aria-pressed={theme === id}
          >
            <span className="theme-picker__swatch">
              {swatch.map((color, i) => (
                <span key={i} style={{ background: color }} />
              ))}
            </span>
            <span className="theme-picker__label">{t(`settings.theme.names.${id}`)}</span>
            {theme === id && (
              <svg className="theme-picker__check" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
              </svg>
            )}
          </button>
        ))}
      </div>

      <div className="category-group" ref={shuffleRef}>
        <div className="category-group__header disclosure-row" onClick={() => toggle('shuffle')}>
          <h4>{t('settings.theme.shuffleSection')}</h4>
          <div className="disclosure-right">
            <DisclosureToggle
              status={shuffleEnabled ? t(`settings.theme.intervals.${shuffleInterval}`) : t('settings.theme.shuffleStatusOff')}
              open={open.shuffle}
              controls={shuffleBodyId}
            />
            <button
              type="button"
              role="switch"
              aria-checked={shuffleEnabled}
              aria-label={t('settings.theme.enableShuffle')}
              className={`reminder-modal__toggle${shuffleEnabled ? ' is-on' : ''}`}
              onClick={(e) => { e.stopPropagation(); setShuffleEnabled(!shuffleEnabled); }}
            >
              <span className="reminder-modal__toggle-knob" />
            </button>
          </div>
        </div>
        {open.shuffle && <div className="theme-shuffle" id={shuffleBodyId}>
          {/* 輪換關閉時照樣展開、內容變灰，可以先預覽、先調好再開 */}
          <div className={`theme-shuffle__options${shuffleEnabled ? '' : ' settings-dimmed'}`}>
            <div className="theme-shuffle__field">
              <span className="theme-shuffle__field-label">{t('settings.theme.shuffleThemes')}</span>
              <div className="theme-shuffle__themes">
                {THEME_OPTIONS.map(({ id, swatch }) => (
                  <label key={id} className={`theme-shuffle__theme-item${shuffleThemes.includes(id) ? ' is-checked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={shuffleThemes.includes(id)}
                      onChange={() => toggleShuffleTheme(id)}
                      className="sr-only"
                    />
                    <span className="theme-shuffle__theme-swatch">
                      {swatch.map((color, i) => <span key={i} style={{ background: color }} />)}
                    </span>
                    <span className="theme-shuffle__theme-label">{t(`settings.theme.names.${id}`)}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="theme-shuffle__field">
              <span className="theme-shuffle__field-label">{t('settings.theme.shuffleInterval')}</span>
              <div className="theme-shuffle__intervals">
                {SHUFFLE_INTERVAL_IDS.map((id) => (
                  <label key={id} className={`theme-shuffle__interval-item${shuffleInterval === id ? ' is-checked' : ''}`}>
                    <input
                      type="radio"
                      name="shuffle-interval"
                      value={id}
                      checked={shuffleInterval === id}
                      onChange={() => setShuffleInterval(id)}
                      className="sr-only"
                    />
                    <span>{t(`settings.theme.intervals.${id}`)}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>}
      </div>
    </div>
  );
}
