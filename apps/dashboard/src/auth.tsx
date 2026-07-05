/**
 * 관리자 인증 컨텍스트 — apps/web/src/auth.tsx와 같은 모양이지만, 채팅 세션과
 * 무관한 별도의 /api/admin/* 엔드포인트(쿠키 lc_admin_sess)를 사용한다.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { adminApi, type AdminMe } from './api';

interface AdminAuthState {
  admin: AdminMe['admin'] | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthState | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminMe['admin'] | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    adminApi
      .me()
      .then((res) => setAdmin(res.admin))
      .catch(() => setAdmin(null))
      .finally(() => setReady(true));
  }, []);

  const value: AdminAuthState = {
    admin,
    ready,
    login: async (username, password) => {
      await adminApi.login(username, password);
      const res = await adminApi.me();
      setAdmin(res.admin);
    },
    logout: async () => {
      await adminApi.logout();
      setAdmin(null);
    },
  };

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth(): AdminAuthState {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider');
  return ctx;
}
