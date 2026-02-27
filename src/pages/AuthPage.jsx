import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import LoginForm from '@/components/auth/LoginForm';
import SignupForm from '@/components/auth/SignupForm';
import '@/styles/auth.css';

export default function AuthPage() {
  const { session, loading } = useAuth();
  const [activeTab, setActiveTab] = useState('login');

  if (loading) return null;
  if (session) return <Navigate to="/" replace />;

  return (
    <div className="auth-container">
      <h1>My Smart Finance</h1>
      <div className="auth-tabs">
        <button
          className={`auth-tab${activeTab === 'login' ? ' active' : ''}`}
          onClick={() => setActiveTab('login')}
        >
          登入
        </button>
        <button
          className={`auth-tab${activeTab === 'signup' ? ' active' : ''}`}
          onClick={() => setActiveTab('signup')}
        >
          註冊
        </button>
      </div>
      {activeTab === 'login' ? <LoginForm /> : <SignupForm />}
    </div>
  );
}
