import { useState, useEffect } from 'react';

const STORAGE_KEY = 'app-theme';
const THEMES = ['default', 'rose'];

function applyTheme(theme) {
  if (theme === 'default') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return THEMES.includes(saved) ? saved : 'default';
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Apply on first mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (THEMES.includes(saved)) applyTheme(saved);
  }, []);

  const setTheme = (t) => {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
  };

  return { theme, setTheme };
}
