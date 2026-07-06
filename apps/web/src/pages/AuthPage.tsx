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
    <div className="flex h-full w-full flex-col md:flex-row">
      {/* 브랜드 패널 — 데스크탑에서는 좌측 히어로, 모바일에서는 상단 메시 밴드 */}
      <div className="mesh pointer-events-none relative h-32 shrink-0 md:hidden" aria-hidden />
      <div className="relative hidden shrink-0 overflow-hidden md:flex md:w-[45%] md:max-w-2xl md:flex-col md:justify-center md:px-16 lg:px-24">
        <div className="mesh pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative">
          <h1 className="display text-6xl text-ink">litechat</h1>
          <p className="mt-4 max-w-sm text-lg text-ink-secondary">
            가볍고 빠른 채팅.
            <br />
            친구와 지금 바로 대화를 시작하세요.
          </p>
        </div>
      </div>

      {/* 폼 패널 — 데스크탑에서는 우측, 세로 중앙 정렬 */}
      <div className="relative flex flex-1 flex-col justify-center px-6">
      <div className="pt-safe pb-safe relative mx-auto w-full max-w-sm">
        <h1 className="display mb-1 text-center text-4xl text-ink md:hidden">litechat</h1>
        <p className="mb-8 text-center text-sm text-ink-mute md:hidden">가볍고 빠른 채팅</p>
        <h2 className="display mb-8 hidden text-center text-2xl text-ink md:block">
          {isRegister ? '회원가입' : '로그인'}
        </h2>

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
    </div>
  );
}
