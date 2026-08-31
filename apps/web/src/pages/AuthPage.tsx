/**
 * 로그인 / 회원가입 화면 — 갤러리 히어로 구성.
 * 왼쪽(모바일은 상단)은 니어블랙 타일에 브랜드 심벌 + 워드마크,
 * 오른쪽은 흰 캔버스의 폼 패널이다.
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, errorMessage, unwrap } from '../api';
import { useAuth } from '../auth';
import { Logo } from '../components/Logo';
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

  // 인풋도 pill — 검색 인풋과 같은 문법 (16px은 iOS 자동 줌 방지)
  const inputClass =
    'w-full rounded-full border border-hairline-input bg-white px-5 py-2.5 text-[16px] outline-none focus:border-primary-focus transition-colors';

  return (
    <div className="flex h-full w-full flex-col md:flex-row">
      {/* 브랜드 히어로 — 니어블랙 타일 (모바일은 상단 밴드, 데스크탑은 좌측 패널) */}
      <div className="pt-safe flex shrink-0 items-center gap-3 bg-brand-dark px-6 py-5 text-white md:w-[45%] md:max-w-2xl md:flex-col md:items-start md:justify-center md:gap-6 md:px-16 lg:px-24">
        <Logo className="h-9 w-9 text-primary-on-dark md:h-16 md:w-16" />
        <div>
          <h1 className="display text-3xl md:text-6xl">litechat</h1>
          <p className="display-airy mt-4 hidden max-w-sm text-2xl text-white/70 md:block">
            가볍게 이어지는 우리 대화.
            <br />
            친구와 편안하게 이야기를 나눠요.
          </p>
        </div>
      </div>

      {/* 폼 패널 — 화이트 캔버스, 세로 중앙 정렬 */}
      <div className="relative flex flex-1 flex-col justify-center px-6">
        <div className="pb-safe relative mx-auto w-full max-w-sm py-10">
          <h2 className="display mb-8 text-center text-2xl text-ink">
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

            {error && (
              <p className="text-center text-sm text-ruby" role="alert">
                {error}
              </p>
            )}

            {/* button-primary pill — 밴드당 하나뿐인 Action Blue CTA */}
            <button
              type="submit"
              disabled={busy}
              className="mt-2 rounded-full bg-primary py-3 text-white transition active:scale-95 active:bg-primary-press disabled:opacity-50"
            >
              {busy ? '잠시만요…' : isRegister ? '가입하기' : '로그인'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-ink-mute">
            {isRegister ? (
              <>
                이미 계정이 있나요?{' '}
                <Link
                  className="font-semibold text-primary underline underline-offset-4"
                  to="/login"
                >
                  로그인
                </Link>
              </>
            ) : (
              <>
                처음이신가요?{' '}
                <Link
                  className="font-semibold text-primary underline underline-offset-4"
                  to="/register"
                >
                  가입하기
                </Link>
              </>
            )}
          </p>
          <p className="mt-5 text-center text-xs leading-5 text-ink-mute">
            서비스 개선과 보안을 위해 접속 IP·기기 정보 등을 처리합니다.{' '}
            <Link className="text-primary underline underline-offset-4" to="/privacy">
              개인정보처리방침
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
