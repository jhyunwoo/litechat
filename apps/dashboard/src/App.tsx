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
        `whitespace-nowrap rounded-full px-4 py-2 text-sm transition-colors ${
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

  // 모바일에서는 탭이 줄바꿈 대신 한 줄 가로 스크롤로 흐른다 (세로 공간 절약)
  const nav = (
    <nav className="no-scrollbar flex gap-2 overflow-x-auto">
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
        {/* 좁은 화면에서는 타이틀+계정 / 내비 두 줄로 쌓이고, lg부터 한 줄로 합쳐진다 */}
        <header className="glass absolute inset-x-0 top-0 z-20 flex flex-col gap-2 border-b border-hairline/60 px-4 py-2.5 lg:flex-row lg:items-center lg:gap-6 lg:px-6">
          <div className="flex items-center justify-between gap-4 lg:contents">
            <h1 className="display text-base lg:text-lg">litechat 대시보드</h1>
            <div className="lg:order-last lg:ml-auto">{account}</div>
          </div>
          {nav}
        </header>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1600px] flex-col gap-4 px-4 py-4 sm:gap-6 sm:px-8 sm:py-8">
      <header className="flex items-center justify-between">
        <h1 className="display text-xl sm:text-2xl">litechat 대시보드</h1>
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
