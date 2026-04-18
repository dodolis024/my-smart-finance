import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import zh from '@/locales/zh';
import en from '@/locales/en';

const DICTIONARIES = { zh, en };
const STORAGE_KEY = 'app-lang';
const DEFAULT_LANG = 'zh';

const LanguageContext = createContext(null);

/**
 * Resolve a dot-notation key against a dictionary object.
 * e.g. get(dict, 'auth.login') → dict.auth.login
 */
function get(obj, key) {
  return key.split('.').reduce((o, k) => (o != null ? o[k] : undefined), obj);
}

/**
 * Replace {placeholder} tokens in a string with values from a params object.
 * e.g. interpolate('Hello {name}', { name: 'World' }) → 'Hello World'
 */
function interpolate(str, params) {
  if (!params || typeof str !== 'string') return str;
  return str.replace(/\{(\w+)\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : `{${key}}`
  );
}

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === 'en' || stored === 'zh' ? stored : DEFAULT_LANG;
    } catch {
      return DEFAULT_LANG;
    }
  });

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.setAttribute('data-lang', lang);
  }, [lang]);

  const setLang = useCallback((newLang) => {
    if (newLang !== 'zh' && newLang !== 'en') return;
    setLangState(newLang);
    try {
      localStorage.setItem(STORAGE_KEY, newLang);
    } catch {
      // ignore
    }
  }, []);

  const toggleLang = useCallback(() => {
    setLang(lang === 'zh' ? 'en' : 'zh');
  }, [lang, setLang]);

  /**
   * Translate a dot-notation key, with optional interpolation params.
   * Falls back to zh if the key is missing in the current language.
   * Returns the key itself if neither language has it.
   *
   * @param {string} key - e.g. 'auth.login', 'streak.unit'
   * @param {Object} [params] - e.g. { count: 5 }
   * @returns {string}
   */
  const t = useCallback(
    (key, params) => {
      const dict = DICTIONARIES[lang];
      let value = get(dict, key);
      if (value === undefined) {
        value = get(DICTIONARIES[DEFAULT_LANG], key);
      }
      if (value === undefined) return key;
      if (typeof value !== 'string') return key;
      return interpolate(value, params);
    },
    [lang]
  );

  return (
    <LanguageContext.Provider value={{ lang, setLang, toggleLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
