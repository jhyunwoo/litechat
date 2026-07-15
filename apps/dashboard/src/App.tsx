/**
 * 라우트 구성 + 로그인 가드
 */
import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router';
import { useAdminAuth } from './auth';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const OverviewPage = lazy(() => import('./pages/OverviewPage'));
const MapPage = lazy(() => import('./pages/MapPage'));
const SessionsPage = lazy(() => import('./pages/SessionsPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const VitalsPage = lazy(() => import('./pages/VitalsPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));

function Loading() {
  return (
    <div className="flex h-full items-center justify-center text-ink-mute">불러오는 중…</div>
  );
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { admin, ready } = useAdminAuth();
  if (!ready) return <Loading />;
  if (!admin) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function Tab({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `rounded-full px-4 py-2 text-sm transition-colors ${
          // primary가 흰색이므로 활성 탭 텍스트는 검정 (white-on-white 방지)
          isActive ? 'bg-primary text-black' : 'text-ink-mute hover:text-white'
        }`
      }
    >
      {label}
    </NavLink>
  );
}

function Shell() {
  const { admin, logout } = useAdminAuth();
  // 지도는 뷰포트 전체를 쓰는 풀블리드 라우트 — 네비게이션이 frosted 바로 지도 위에 뜬다
  const isMap = useLocation().pathname === '/map';

  const nav = (
    <nav className="flex flex-wrap gap-2">
      <Tab to="/" label="개요" />
      <Tab to="/map" label="지도" />
      <Tab to="/sessions" label="접속 기록" />
      <Tab to="/users" label="사용자별 방문" />
      <Tab to="/vitals" label="웹 바이탈" />
      <Tab to="/notifications" label="알림 로그" />
    </nav>
  );
  const account = (
    <div className="flex items-center gap-3 text-sm text-ink-mute">
      <span>{admin?.username}</span>
      <button onClick={() => void logout()} className="hover:text-white">
        로그아웃
      </button>
    </div>
  );

  if (isMap) {
    return (
      <div className="relative h-dvh overflow-hidden">
        <main className="absolute inset-0">
          <Outlet />
        </main>
        <header className="glass absolute inset-x-0 top-0 z-20 flex items-center gap-6 border-b border-hairline/60 px-6 py-2.5">
          <h1 className="display text-lg">litechat 대시보드</h1>
          {nav}
          <div className="ml-auto">{account}</div>
        </header>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1600px] flex-col gap-6 px-8 py-8">
      <header className="flex items-center justify-between">
        <h1 className="display text-2xl">litechat 대시보드</h1>
        {account}
      </header>
      {nav}
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAdmin>
              <Shell />
            </RequireAdmin>
          }
        >
          <Route path="/" element={<OverviewPage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/vitals" element={<VitalsPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
