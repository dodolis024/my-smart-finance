import { useState, useEffect } from 'react';

const STORAGE_KEY = 'app-theme';
const SHUFFLE_ENABLED_KEY = 'theme-shuffle-enabled';
const SHUFFLE_THEMES_KEY = 'theme-shuffle-themes';
const SHUFFLE_INTERVAL_KEY = 'theme-shuffle-interval';
const SHUFFLE_LAST_KEY = 'theme-shuffle-last';

export const THEMES = ['default', 'rose', 'gray'];

function applyTheme(theme) {
  if (theme === 'default') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

function shouldShuffle(interval, lastStr) {
  if (interval === 'open') return true;
  if (!lastStr) return true;
  const last = new Date(lastStr);
  const now = new Date();
  if (interval === 'daily') return now.toDateString() !== last.toDateString();
  const diffMs = now - last;
  if (interval === 'weekly') return diffMs >= 7 * 24 * 60 * 60 * 1000;
  if (interval === 'monthly') return diffMs >= 30 * 24 * 60 * 60 * 1000;
  return false;
}

function pickRandom(themes, current) {
  const choices = themes.length > 1 ? themes.filter(t => t !== current) : themes;
  return choices[Math.floor(Math.random() * choices.length)];
}

function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  const shuffleEnabled = localStorage.getItem(SHUFFLE_ENABLED_KEY) === 'true';

  if (shuffleEnabled) {
    let shuffleThemes;
    try { shuffleThemes = JSON.parse(localStorage.getItem(SHUFFLE_THEMES_KEY)); } catch {}
    if (!Array.isArray(shuffleThemes) || shuffleThemes.length === 0) shuffleThemes = [...THEMES];

    const interval = localStorage.getItem(SHUFFLE_INTERVAL_KEY) || 'daily';
    const last = localStorage.getItem(SHUFFLE_LAST_KEY);

    if (shouldShuffle(interval, last)) {
      const current = THEMES.includes(saved) ? saved : 'default';
      const next = pickRandom(shuffleThemes, current);
      localStorage.setItem(STORAGE_KEY, next);
      localStorage.setItem(SHUFFLE_LAST_KEY, new Date().toISOString());
      applyTheme(next);
      return next;
    }
  }

  const theme = THEMES.includes(saved) ? saved : 'default';
  applyTheme(theme);
  return theme;
}

export function useTheme() {
  const [theme, setThemeState] = useState(() => initTheme());

  const [shuffleEnabled, setShuffleEnabledState] = useState(() =>
    localStorage.getItem(SHUFFLE_ENABLED_KEY) === 'true'
  );
  const [shuffleThemes, setShuffleThemesState] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SHUFFLE_THEMES_KEY));
      if (Array.isArray(saved) && saved.length > 0) return saved;
    } catch {}
    return [...THEMES];
  });
  const [shuffleInterval, setShuffleIntervalState] = useState(() =>
    localStorage.getItem(SHUFFLE_INTERVAL_KEY) || 'daily'
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = (t) => {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
  };

  const setShuffleEnabled = (v) => {
    setShuffleEnabledState(v);
    localStorage.setItem(SHUFFLE_ENABLED_KEY, String(v));
  };

  const setShuffleThemes = (arr) => {
    setShuffleThemesState(arr);
    localStorage.setItem(SHUFFLE_THEMES_KEY, JSON.stringify(arr));
  };

  const setShuffleInterval = (v) => {
    setShuffleIntervalState(v);
    localStorage.setItem(SHUFFLE_INTERVAL_KEY, v);
  };

  return {
    theme, setTheme,
    shuffleEnabled, setShuffleEnabled,
    shuffleThemes, setShuffleThemes,
    shuffleInterval, setShuffleInterval,
  };
}
