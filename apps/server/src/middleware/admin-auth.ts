/**
 * 관리자 인증 미들웨어 — lc_admin_sess 쿠키만 검사한다.
 *
 * 대시보드는 브라우저 전용 앱이라 middleware/auth.ts의 Bearer/쿠키 이중 처리가 필요 없다.
 * 채팅 세션(lc_sess)과는 완전히 다른 쿠키/네임스페이스를 사용하므로 서로 넘나들 수 없다.
 */
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppAdminEnv } from '../modules/admin/routes';
import type { AppDeps } from '../deps';
import { ADMIN_SESSION_COOKIE, getAdminSessionId } from '../modules/admin/session';

export function requireAdmin(deps: AppDeps): MiddlewareHandler<AppAdminEnv> {
  return async (c, next) => {
    const token = getCookie(c, ADMIN_SESSION_COOKIE);
    if (!token) return c.json({ error: 'UNAUTHORIZED' }, 401);

    const adminId = await getAdminSessionId(deps, token);
    if (adminId === null) return c.json({ error: 'UNAUTHORIZED' }, 401);

    c.set('adminId', adminId);
    await next();
  };
}
