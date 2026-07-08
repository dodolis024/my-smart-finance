import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import AuthLangSwitch from '@/components/auth/AuthLangSwitch';
import '@/styles/auth.css';

export default function ResetPasswordPage() {
  const { session, loading, updatePassword } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
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
    if (password.length < 6) {
      setError(t('auth.passwordTooShort'));
      return;
    }

    setSubmitting(true);
    try {
      await updatePassword(password);
      setSuccess(t('auth.passwordUpdated'));
      setTimeout(() => navigate('/'), 1500);
    } catch (err) {
      const msg = (typeof err === 'string' ? err : err?.message ?? err?.error?.message ?? '').toString();
      const lower = msg.toLowerCase();
      const friendly =
        lower.includes('different') ? t('auth.samePassword') :
        (lower.includes('rate') || lower.includes('too many')) ? t('auth.tooManyAttempts') :
        t('auth.updatePasswordFailed');
      setError(friendly);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '50vh',
          fontSize: '1.25rem',
          color: 'var(--color-text-secondary)',
        }}
        role="status"
        aria-live="polite"
      >
        {t('common.loading')}
      </div>
    );
  }

  if (!session) {
    return (
      <div className="auth-container">
        <AuthLangSwitch />
        <h1>{t('auth.resetTitle')}</h1>
        <div className="auth-error">{t('auth.resetLinkInvalid')}</div>
        <Link to="/forgot-password" className="auth-link auth-back-link">{t('auth.sendResetLink')}</Link>
        <br />
        <Link to="/auth" className="auth-link auth-back-link">{t('auth.backToLogin')}</Link>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <AuthLangSwitch />
      <h1>{t('auth.resetTitle')}</h1>
      <form className="auth-form" onSubmit={handleSubmit}>
        <label htmlFor="reset-password" className="sr-only">{t('auth.newPassword')}</label>
        <input
          id="reset-password"
          type="password"
          placeholder={t('auth.newPassword')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength="6"
        />
        <label htmlFor="reset-password-confirm" className="sr-only">{t('auth.confirmNewPassword')}</label>
        <input
          id="reset-password-confirm"
          type="password"
          placeholder={t('auth.confirmNewPassword')}
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          required
        />
        <button type="submit" disabled={submitting}>
          {submitting ? t('auth.updatingPassword') : t('auth.updatePassword')}
        </button>
        {error && <div className="auth-error">{error}</div>}
        {success && <div className="auth-success">{success}</div>}
      </form>
    </div>
  );
}
