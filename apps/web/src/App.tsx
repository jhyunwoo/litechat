/**
 * 라우트 구성 + 로그인 가드
 *
 * /            → 채팅 탭 (기본)
 * /friends     → 친구 탭
 * /profile     → 프로필 탭
 * /chat/:id    → 채팅방
 * /login /register → 인증 화면
 */
import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { useAuth } from './auth';
import { Shell } from './pages/Shell';

// 인증 화면과 채팅방은 코드 분할로 초기 청크에서 제외한다.
const AuthPage = lazy(() => import('./pages/AuthPage'));
const ChatRoom = lazy(() => import('./pages/ChatRoom'));
const ChatsTab = lazy(() => import('./pages/ChatsTab'));
const FriendsTab = lazy(() => import('./pages/FriendsTab'));
const ProfileTab = lazy(() => import('./pages/ProfileTab'));
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

export default function App() {
  const { me, ready } = useAuth();

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
          path="/chat/:id"
          element={
            <RequireAuth>
              <ChatRoom />
            </RequireAuth>
          }
        />
        <Route
          path="/onboarding"
          element={
            <RequireAuth>
              <Onboarding />
            </RequireAuth>
          }
        />
        <Route
          element={
            <RequireAuth>
              <Shell />
            </RequireAuth>
          }
        >
          <Route path="/" element={<ChatsTab />} />
          <Route path="/friends" element={<FriendsTab />} />
          <Route path="/profile" element={<ProfileTab />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
