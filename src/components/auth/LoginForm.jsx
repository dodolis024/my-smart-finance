import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import GoogleAuthButton from './GoogleAuthButton';

export default function LoginForm() {
  const { signInWithPassword } = useAuth();
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
        (lower.includes('invalid') && lower.includes('credential')) ? '帳號或密碼錯誤，請再試一次' :
        lower.includes('email not confirmed') ? '請先到信箱收取驗證信並完成驗證' :
        (lower.includes('rate') || lower.includes('too many')) ? '嘗試次數過多，請稍後再試' :
        msg || '登入失敗，請檢查帳號密碼';
      setError(friendly);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label htmlFor="login-email" className="sr-only">電子郵件</label>
      <input
        id="login-email"
        type="email"
        placeholder="電子郵件"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <label htmlFor="login-password" className="sr-only">密碼</label>
      <input
        id="login-password"
        type="password"
        placeholder="密碼"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <button type="submit" disabled={submitting}>
        {submitting ? '登入中...' : '登入'}
      </button>
      {error && <div className="auth-error">{error}</div>}
      <div className="auth-divider"><span>或</span></div>
      <GoogleAuthButton label="使用 Google 登入" />
    </form>
  );
}
