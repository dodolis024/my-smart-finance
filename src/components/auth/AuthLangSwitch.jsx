import { useLanguage } from '@/contexts/LanguageContext';

export default function AuthLangSwitch() {
  const { t, lang, setLang } = useLanguage();

  return (
    <div className="auth-lang-switch" role="group" aria-label={t('auth.languageLabel')}>
      <button
        type="button"
        className={`auth-lang${lang === 'zh' ? ' active' : ''}`}
        onClick={() => setLang('zh')}
        aria-pressed={lang === 'zh'}
      >
        中文
      </button>
      <button
        type="button"
        className={`auth-lang${lang === 'en' ? ' active' : ''}`}
        onClick={() => setLang('en')}
        aria-pressed={lang === 'en'}
      >
        EN
      </button>
    </div>
  );
}
