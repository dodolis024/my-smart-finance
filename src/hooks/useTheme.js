import { useState, useEffect, createContext, useContext, createElement } from 'react';

const STORAGE_KEY = 'app-theme';
const SHUFFLE_ENABLED_KEY = 'theme-shuffle-enabled';
const SHUFFLE_THEMES_KEY = 'theme-shuffle-themes';
const SHUFFLE_INTERVAL_KEY = 'theme-shuffle-interval';
const SHUFFLE_LAST_KEY = 'theme-shuffle-last';

export const THEMES = ['default', 'rose', 'graphite', 'dawn', 'soda', 'lavender', 'sorbet', 'peach', 'lime', 'maple'];

// 瀏覽器「封鎖所有 cookie／網站資料」時，碰 window.localStorage 會直接丟 SecurityError。
// 這個 Provider 在 App 最外層的 render 期初始化，沒包住的話整個 App 進不去、只剩錯誤頁，
// 而主題只是外觀，讀不到就用預設、寫不進去就只是不跨重整保留
function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, value); } catch { /* 無痕、配額滿或儲存被封鎖 */ }
}

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

function migrateGrayToGraphite() {
  const raw = readStorage(STORAGE_KEY);
  if (raw === 'gray') writeStorage(STORAGE_KEY, 'graphite');
}

function readShuffleThemes() {
  try {
    const saved = JSON.parse(readStorage(SHUFFLE_THEMES_KEY));
    if (Array.isArray(saved) && saved.length > 0) return saved;
  } catch { /* 沒存過或格式壞掉 */ }
  return [...THEMES];
}

function initTheme() {
  migrateGrayToGraphite();
  if (_initThemeDone) {
    const saved = readStorage(STORAGE_KEY);
    const theme = THEMES.includes(saved) ? saved : 'default';
    applyTheme(theme);
    return theme;
  }
  _initThemeDone = true;

  const saved = readStorage(STORAGE_KEY);
  const shuffleEnabled = readStorage(SHUFFLE_ENABLED_KEY) === 'true';

  if (shuffleEnabled) {
    const shuffleThemes = readShuffleThemes();
    const interval = readStorage(SHUFFLE_INTERVAL_KEY) || 'daily';
    const last = readStorage(SHUFFLE_LAST_KEY);

    if (shouldShuffle(interval, last)) {
      const current = THEMES.includes(saved) ? saved : 'default';
      const next = pickRandom(shuffleThemes, current);
      writeStorage(STORAGE_KEY, next);
      writeStorage(SHUFFLE_LAST_KEY, new Date().toISOString());
      applyTheme(next);
      return next;
    }
  }

  const theme = THEMES.includes(saved) ? saved : 'default';
  applyTheme(theme);
  return theme;
}

let _initThemeDone = false;

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => initTheme());

  const [shuffleEnabled, setShuffleEnabledState] = useState(() =>
    readStorage(SHUFFLE_ENABLED_KEY) === 'true'
  );
  const [shuffleThemes, setShuffleThemesState] = useState(readShuffleThemes);
  const [shuffleInterval, setShuffleIntervalState] = useState(() =>
    readStorage(SHUFFLE_INTERVAL_KEY) || 'daily'
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = (t) => {
    // 先套到 <html> 再更新 state：圖表在 render 時讀 CSS 變數取色，等 effect 才套的話會讀到舊主題的顏色
    applyTheme(t);
    setThemeState(t);
    writeStorage(STORAGE_KEY, t);
  };

  const setShuffleEnabled = (v) => {
    setShuffleEnabledState(v);
    writeStorage(SHUFFLE_ENABLED_KEY, String(v));
  };

  const setShuffleThemes = (arr) => {
    setShuffleThemesState(arr);
    writeStorage(SHUFFLE_THEMES_KEY, JSON.stringify(arr));
  };

  const setShuffleInterval = (v) => {
    setShuffleIntervalState(v);
    writeStorage(SHUFFLE_INTERVAL_KEY, v);
  };

  return createElement(ThemeContext.Provider, {
    value: {
      theme, setTheme,
      shuffleEnabled, setShuffleEnabled,
      shuffleThemes, setShuffleThemes,
      shuffleInterval, setShuffleInterval,
    },
  }, children);
}

export function useTheme() {
  return useContext(ThemeContext);
}
