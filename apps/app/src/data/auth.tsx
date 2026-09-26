/**
 * 인증 컨텍스트 — apps/web/src/auth.tsx의 네이티브 포팅
 *
 * 차이점:
 *   - 부팅 시 Keychain에서 토큰을 hydrate한 뒤에 me를 조회한다
 *   - 로그인/가입 응답의 token을 Keychain에 저장한다
 *   - 로그아웃 시 Expo 푸시 토큰도 서버에서 해지한다
 */
import type { PublicUser } from '@litechat/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, unwrap } from '@/lib/api';
import { clearAnalyticsIdentity } from '@/lib/analytics';
import { clearLocalPushState, unregisterPush } from '@/lib/notifications';
import { clearToken, hydrateToken, setToken } from '@/lib/session';
import { socket } from '@/lib/ws';
import { clearSessionCaches } from './data';

interface Credentials {
  username: string;
  password: string;
}

interface AuthState {
  /** 로그인된 사용자 (미로그인/로딩 중이면 null) */
  me: PublicUser | null;
  /** 초기 세션 확인이 끝났는지 (스플래시 유지 판단) */
  ready: boolean;
  bootstrapError: boolean;
  retryBootstrap: () => void;
  login: (credentials: Credentials) => Promise<void>;
  register: (input: Credentials & { nickname: string }) => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  // Keychain 토큰을 먼저 불러와야 me 조회에 Bearer 헤더가 붙는다.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    void hydrateToken()
      .catch(() => null)
      .finally(() => setHydrated(true));
  }, []);

  // 앱 시작 시 저장된 토큰으로 내 정보를 확인한다.
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await api.api.auth.me.$get();
      if (res.status === 401) return null;
      return (await unwrap<{ user: PublicUser }>(res)).user;
    },
    staleTime: Infinity,
    retry: false,
    enabled: hydrated,
  });

  const me = data ?? null;

  // 로그인 상태에 맞춰 WebSocket 연결을 관리한다.
  useEffect(() => {
    if (me) socket.start();
    else socket.stop();
    return () => socket.stop();
  }, [me]);

  /** 로그인/가입 공통 후처리 — 토큰 저장 + me 캐시 갱신 */
  async function signedIn(user: PublicUser, token: string): Promise<void> {
    await setToken(token);
    queryClient.setQueryData(['me'], user);
  }

  const value: AuthState = {
    me,
    ready: hydrated && !isPending,
    bootstrapError: hydrated && isError,
    retryBootstrap: () => void refetch(),
    login: async (credentials) => {
      const res = await api.api.auth.login.$post({ json: credentials });
      const { user, token } = await unwrap<{ user: PublicUser; token: string }>(res);
      await signedIn(user, token);
    },
    register: async (input) => {
      const res = await api.api.auth.register.$post({ json: input });
      const { user, token } = await unwrap<{ user: PublicUser; token: string }>(res);
      await signedIn(user, token);
    },
    logout: async () => {
      // 이 기기의 푸시 토큰을 먼저 해지한다 (세션이 살아 있을 때만 가능).
      await unregisterPush().catch(() => {});
      await api.api.auth.logout.$post().catch(() => {});
      socket.stop();
      await clearToken().catch(() => {});
      clearSessionCaches(); // react-query 외 모듈 캐시(인용 미리보기 등)도 지운다
      // me를 먼저 null로 만들어 화면을 즉시 로그아웃 상태로 전환하고,
      // 나머지 캐시만 제거한다. (clear()는 me 쿼리까지 비워 재조회 레이스를 만든다)
      queryClient.setQueryData(['me'], null);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'me' });
    },
    deleteAccount: async (password) => {
      const res = await api.api.auth.account.$delete({ json: { password } });
      await unwrap(res);
      socket.stop();
      clearSessionCaches();
      // The server deletion has committed. Local cleanup is best effort per
      // storage API, but the in-memory token/cache must always be invalidated.
      await Promise.allSettled([clearToken(), clearAnalyticsIdentity(), clearLocalPushState()]);
      queryClient.clear();
      queryClient.setQueryData(['me'], null);
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
