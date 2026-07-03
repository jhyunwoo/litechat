/**
 * 로그인 / 회원가입 화면
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, errorMessage, unwrap } from '../api';
import { useAuth } from '../auth';
import type { PublicUser } from '@litechat/types';

export default function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { setMe } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isRegister = mode === 'register';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = isRegister
        ? await api.api.auth.register.$post({ json: { username, password, nickname } })
        : await api.api.auth.login.$post({ json: { username, password } });
      const { user } = await unwrap<{ user: PublicUser }>(res);
      setMe(user);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // DESIGN.md text-input: 흰 배경 + hairline-input 보더 + 6px 라운드, 포커스 시 primary 보더
  const inputClass =
    'w-full rounded-md border border-hairline-input bg-white px-3 py-2.5 text-[16px] outline-none focus:border-primary transition-colors';

  return (
    <div className="relative mx-auto flex h-full max-w-sm flex-col justify-center px-6">
      {/* 그라디언트 메시 밴드 — 마케팅 히어로의 브랜드 시그니처 (상단 1/3) */}
      <div className="mesh pointer-events-none absolute inset-x-0 top-0 h-1/3" aria-hidden />

      <div className="pt-safe pb-safe relative">
        <h1 className="display mb-1 text-center text-4xl text-ink">LiteChat</h1>
        <p className="mb-8 text-center text-sm text-ink-mute">가볍고 빠른 채팅</p>

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <input
          className={inputClass}
          placeholder="아이디 (영문 소문자/숫자/_)"
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
          autoComplete="username"
          autoCapitalize="none"
          required
          minLength={3}
          maxLength={20}
          pattern="[a-z0-9_]{3,20}"
        />
        {isRegister && (
          <input
            className={inputClass}
            placeholder="닉네임"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            required
            maxLength={20}
          />
        )}
        <input
          className={inputClass}
          type="password"
          placeholder="비밀번호 (8자 이상)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={isRegister ? 'new-password' : 'current-password'}
          required
          minLength={8}
          maxLength={72}
        />

        {error && <p className="text-center text-sm text-ruby">{error}</p>}

        {/* button-primary-pill — 밴드당 하나뿐인 채워진 인디고 CTA */}
        <button
          type="submit"
          disabled={busy}
          className="mt-2 rounded-full bg-primary py-3 font-normal text-white transition active:scale-[0.98] active:bg-primary-press disabled:opacity-50"
        >
          {busy ? '잠시만요…' : isRegister ? '가입하기' : '로그인'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-mute">
        {isRegister ? (
          <>
            이미 계정이 있나요?{' '}
            <Link className="font-normal text-primary" to="/login">
              로그인
            </Link>
          </>
        ) : (
          <>
            처음이신가요?{' '}
            <Link className="font-normal text-primary" to="/register">
              가입하기
            </Link>
          </>
        )}
      </p>
      </div>
    </div>
  );
}
