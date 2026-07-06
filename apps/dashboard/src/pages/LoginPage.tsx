/**
 * 관리자 로그인 화면
 */
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { ApiFailure } from '../api';
import { useAdminAuth } from '../auth';

export default function LoginPage() {
  const { admin, ready, login } = useAdminAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (ready && admin) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiFailure ? '아이디 또는 비밀번호가 올바르지 않아요.' : '문제가 발생했어요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center">
      <form onSubmit={onSubmit} className="w-full max-w-xs rounded-xl border border-hairline bg-card p-8">
        <h1 className="display mb-6 text-center text-2xl">litechat 대시보드</h1>
        <div className="flex flex-col gap-3">
          <input
            className="rounded-md border border-hairline bg-shell px-3 py-2.5 outline-none focus:border-primary"
            placeholder="관리자 아이디"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
            required
          />
          <input
            className="rounded-md border border-hairline bg-shell px-3 py-2.5 outline-none focus:border-primary"
            type="password"
            placeholder="비밀번호"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className="text-center text-sm text-danger">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="mt-2 rounded-full bg-primary py-2.5 font-normal text-white transition disabled:opacity-50"
          >
            {busy ? '로그인 중…' : '로그인'}
          </button>
        </div>
      </form>
    </div>
  );
}
