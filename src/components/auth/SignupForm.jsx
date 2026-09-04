import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { MIN_PASSWORD_LENGTH } from '@/lib/constants';
import GoogleAuthButton from './GoogleAuthButton';

export default function SignupForm() {
  const { signUp } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (password !== passwordConfirm) {
      setError(t('auth.passwordMismatch'));
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('auth.passwordTooShort', { count: MIN_PASSWORD_LENGTH }));
      return;
    }

    setSubmitting(true);
    try {
      await signUp(email, password);
      setSuccess(t('auth.signupSuccess'));
      setTimeout(() => navigate('/'), 1500);
    } catch (err) {
      setError(err.message || t('auth.signupFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label htmlFor="signup-email" className="sr-only">{t('auth.email')}</label>
      <input
        id="signup-email"
        type="email"
        placeholder={t('auth.email')}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <label htmlFor="signup-password" className="sr-only">{t('auth.passwordMin')}</label>
      <input
        id="signup-password"
        type="password"
        placeholder={t('auth.passwordMin')}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        minLength={MIN_PASSWORD_LENGTH}
      />
      <label htmlFor="signup-password-confirm" className="sr-only">{t('auth.confirmPassword')}</label>
      <input
        id="signup-password-confirm"
        type="password"
        placeholder={t('auth.confirmPassword')}
        value={passwordConfirm}
        onChange={(e) => setPasswordConfirm(e.target.value)}
        required
      />
      <button type="submit" disabled={submitting}>
        {submitting ? t('auth.signingUp') : t('auth.signup')}
      </button>
      {error && <div className="auth-error">{error}</div>}
      {success && <div className="auth-success">{success}</div>}
      <div className="auth-divider"><span>{t('common.or')}</span></div>
      <GoogleAuthButton label={t('auth.googleSignUp')} />
    </form>
  );
}
