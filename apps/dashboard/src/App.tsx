/**
 * 라우트 구성 + 로그인 가드
 */
import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router';
import { useAdminAuth } from './auth';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const OverviewPage = lazy(() => import('./pages/OverviewPage'));
const MapPage = lazy(() => import('./pages/MapPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const VitalsPage = lazy(() => import('./pages/VitalsPage'));

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
          isActive ? 'bg-primary text-white' : 'text-ink-mute hover:text-white'
        }`
      }
    >
      {label}
    </NavLink>
  );
}

function Shell() {
  const { admin, logout } = useAdminAuth();
  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col gap-6 px-6 py-8">
      <header className="flex items-center justify-between">
        <h1 className="display text-2xl">litechat 대시보드</h1>
        <div className="flex items-center gap-3 text-sm text-ink-mute">
          <span>{admin?.username}</span>
          <button onClick={() => void logout()} className="hover:text-white">
            로그아웃
          </button>
        </div>
      </header>
      <nav className="flex gap-2">
        <Tab to="/" label="개요" />
        <Tab to="/map" label="지도" />
        <Tab to="/users" label="사용자별 방문" />
        <Tab to="/vitals" label="웹 바이탈" />
      </nav>
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
          <Route path="/users" element={<UsersPage />} />
          <Route path="/vitals" element={<VitalsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
