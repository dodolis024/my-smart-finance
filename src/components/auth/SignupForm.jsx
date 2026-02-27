import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import GoogleAuthButton from './GoogleAuthButton';

export default function SignupForm() {
  const { signUp } = useAuth();
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
      setError('兩次輸入的密碼不一致');
      return;
    }
    if (password.length < 6) {
      setError('密碼長度至少需要6個字元');
      return;
    }

    setSubmitting(true);
    try {
      await signUp(email, password);
      setSuccess('註冊成功！正在跳轉...');
      setTimeout(() => navigate('/'), 1500);
    } catch (err) {
      setError(err.message || '註冊失敗，請稍後再試');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <input
        type="email"
        placeholder="電子郵件"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <input
        type="password"
        placeholder="密碼（至少6個字元）"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        minLength="6"
      />
      <input
        type="password"
        placeholder="確認密碼"
        value={passwordConfirm}
        onChange={(e) => setPasswordConfirm(e.target.value)}
        required
      />
      <button type="submit" disabled={submitting}>
        {submitting ? '註冊中...' : '註冊'}
      </button>
      {error && <div className="auth-error">{error}</div>}
      {success && <div className="auth-success">{success}</div>}
      <div className="auth-divider"><span>或</span></div>
      <GoogleAuthButton label="使用 Google 註冊" />
    </form>
  );
}
