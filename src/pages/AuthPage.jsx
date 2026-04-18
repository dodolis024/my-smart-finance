import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import LoginForm from '@/components/auth/LoginForm';
import SignupForm from '@/components/auth/SignupForm';
import '@/styles/auth.css';

function LoadingFallback() {
  const { t } = useLanguage();
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

export default function AuthPage() {
  const { session, loading } = useAuth();
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState('login');

  if (loading) return <LoadingFallback />;
  if (session) {
    const returnUrl = sessionStorage.getItem('returnUrl');
    if (returnUrl) {
      sessionStorage.removeItem('returnUrl');
      return <Navigate to={returnUrl} replace />;
    }
    return <Navigate to="/" replace />;
  }

  return (
    <div className="auth-container">
      <h1>My Smart Finance</h1>
      <div className="auth-tabs">
        <button
          className={`auth-tab${activeTab === 'login' ? ' active' : ''}`}
          onClick={() => setActiveTab('login')}
        >
          {t('auth.loginTab')}
        </button>
        <button
          className={`auth-tab${activeTab === 'signup' ? ' active' : ''}`}
          onClick={() => setActiveTab('signup')}
        >
          {t('auth.signupTab')}
        </button>
      </div>
      {activeTab === 'login' ? <LoginForm /> : <SignupForm />}
    </div>
  );
}
