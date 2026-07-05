/**
 * 라우트 구성 + 로그인 가드
 *
 * /            → 채팅 탭 (기본)
 * /friends     → 친구 탭
 * /profile     → 프로필 탭
 * /chat/:id    → 채팅방
 * /login /register → 인증 화면
 */
import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { trackPageview } from './analytics';
import { useAuth } from './auth';
import { Shell } from './pages/Shell';
import ChatDetailEmpty from './pages/ChatDetailEmpty';

// 인증 화면과 채팅방(무거운 애니메이션·이모지·이미지 뷰어)은 코드 분할로 초기 청크에서 제외한다.
// 세 탭(ChatsTab/FriendsTab/ProfileTab)은 로그인 후 즉시 필요하므로 Shell이 직접 가져온다.
const AuthPage = lazy(() => import('./pages/AuthPage'));
const ChatRoom = lazy(() => import('./pages/ChatRoom'));
const Onboarding = lazy(() => import('./pages/Onboarding'));

/** 전체 화면 로딩 스피너 */
function Loading() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

/** 로그인 필수 가드 */
function RequireAuth({ children }: { children: ReactNode }) {
  const { me, ready } = useAuth();
  if (!ready) return <Loading />;
  if (!me) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** SPA 라우트 전환마다(최초 진입 포함) 페이지뷰를 기록한다 */
function useAnalyticsPageview() {
  const location = useLocation();
  useEffect(() => {
    trackPageview(location.pathname);
  }, [location.pathname]);
}

export default function App() {
  const { me, ready } = useAuth();
  useAnalyticsPageview();

  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route
          path="/login"
          element={ready && me ? <Navigate to="/" replace /> : <AuthPage mode="login" />}
        />
        <Route
          path="/register"
          element={ready && me ? <Navigate to="/" replace /> : <AuthPage mode="register" />}
        />
        <Route
          path="/onboarding"
          element={
            <RequireAuth>
              <Onboarding />
            </RequireAuth>
          }
        />
        {/* 셸 레이아웃 — 리스트 컬럼은 Shell이 섹션별로 렌더하고, 아래 라우트는 디테일 컬럼을 채운다. */}
        <Route
          element={
            <RequireAuth>
              <Shell />
            </RequireAuth>
          }
        >
          <Route path="/" element={<ChatDetailEmpty />} />
          <Route path="/friends" element={<ChatDetailEmpty />} />
          <Route path="/profile" element={<ChatDetailEmpty />} />
          <Route path="/chat/:id" element={<ChatRoom />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
