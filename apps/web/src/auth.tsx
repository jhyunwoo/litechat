/**
 * 인증 컨텍스트 — 현재 사용자 상태와 로그인/로그아웃 동작
 *
 * 로그인되면 WebSocket을 연결하고, 로그아웃하면 끊는다.
 */
import type { PublicUser } from '@litechat/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { api, unwrap } from './api';
import { clearSessionCaches } from './data';
import { socket } from './ws';

interface AuthState {
  /** 로그인된 사용자 (미로그인/로딩 중이면 null) */
  me: PublicUser | null;
  /** 초기 세션 확인이 끝났는지 */
  ready: boolean;
  /** 로그인/가입 성공 후 호출 — 캐시를 채우고 소켓을 연결한다 */
  setMe: (user: PublicUser) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  // 앱 시작 시 세션 쿠키로 내 정보를 확인한다.
  const { data, isPending } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await api.api.auth.me.$get();
      if (res.status === 401) return null;
      return (await unwrap<{ user: PublicUser }>(res)).user;
    },
    staleTime: Infinity,
    retry: false,
  });

  const me = data ?? null;

  // 로그인 상태에 맞춰 WebSocket 연결을 관리한다.
  useEffect(() => {
    if (me) socket.start();
    else socket.stop();
    return () => socket.stop();
  }, [me?.id]);

  const value: AuthState = {
    me,
    ready: !isPending,
    setMe: (user) => queryClient.setQueryData(['me'], user),
    logout: async () => {
      await api.api.auth.logout.$post();
      socket.stop();
      clearSessionCaches(); // react-query 외 모듈 캐시(인용 미리보기 등)도 지운다
      // me를 먼저 null로 만들어 화면을 즉시 로그아웃 상태로 전환하고,
      // 나머지 캐시만 제거한다. (clear()는 me 쿼리까지 비워 재조회 레이스를 만든다)
      queryClient.setQueryData(['me'], null);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'me' });
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** 인증 상태 훅 — AuthProvider 아래에서만 사용 */
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
