import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import ForgotPasswordForm from '@/components/auth/ForgotPasswordForm';
import AuthLangSwitch from '@/components/auth/AuthLangSwitch';
import '@/styles/auth.css';

export default function ForgotPasswordPage() {
  const { t } = useLanguage();

  return (
    <div className="auth-container">
      <AuthLangSwitch />
      <h1>{t('auth.forgotTitle')}</h1>
      <p className="auth-hint">{t('auth.forgotHint')}</p>
      <ForgotPasswordForm />
      <Link to="/auth" className="auth-link auth-back-link">{t('auth.backToLogin')}</Link>
    </div>
  );
}
