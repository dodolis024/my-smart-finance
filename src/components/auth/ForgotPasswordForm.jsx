import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';

export default function ForgotPasswordForm() {
  const { sendPasswordReset } = useAuth();
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      await sendPasswordReset(email);
      setSent(true);
    } catch (err) {
      const msg = (typeof err === 'string' ? err : err?.message ?? err?.error?.message ?? '').toString();
      const lower = msg.toLowerCase();
      const friendly =
        (lower.includes('rate') || lower.includes('too many')) ? t('auth.tooManyAttempts') :
        t('auth.sendResetFailed');
      setError(friendly);
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return <div className="auth-success">{t('auth.resetLinkSent')}</div>;
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label htmlFor="forgot-email" className="sr-only">{t('auth.email')}</label>
      <input
        id="forgot-email"
        type="email"
        placeholder={t('auth.email')}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <button type="submit" disabled={submitting}>
        {submitting ? t('auth.sendingResetLink') : t('auth.sendResetLink')}
      </button>
      {error && <div className="auth-error">{error}</div>}
    </form>
  );
}
