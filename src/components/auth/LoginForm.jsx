import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import GoogleAuthButton from './GoogleAuthButton';

export default function LoginForm() {
  const { signInWithPassword } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      await signInWithPassword(email, password);
      navigate('/');
    } catch (err) {
      const msg = (typeof err === 'string' ? err : err?.message ?? err?.error?.message ?? '').toString();
      const lower = msg.toLowerCase();
      const friendly =
        (lower.includes('invalid') && lower.includes('credential')) ? t('auth.invalidCredential') :
        lower.includes('email not confirmed') ? t('auth.emailNotConfirmed') :
        (lower.includes('rate') || lower.includes('too many')) ? t('auth.tooManyAttempts') :
        msg || t('auth.loginFailed');
      setError(friendly);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label htmlFor="login-email" className="sr-only">{t('auth.email')}</label>
      <input
        id="login-email"
        type="email"
        placeholder={t('auth.email')}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <label htmlFor="login-password" className="sr-only">{t('auth.password')}</label>
      <input
        id="login-password"
        type="password"
        placeholder={t('auth.password')}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <button type="submit" disabled={submitting}>
        {submitting ? t('auth.loggingIn') : t('auth.login')}
      </button>
      {error && <div className="auth-error">{error}</div>}
      <div className="auth-divider"><span>{t('common.or')}</span></div>
      <GoogleAuthButton label={t('auth.googleSignIn')} />
    </form>
  );
}
