/**
 * 인증 미들웨어 — 세션 쿠키를 검증하고 c.var.userId를 채운다.
 *
 * REST API와 WebSocket 업그레이드 요청 모두 이 미들웨어를 통과한다.
 * (브라우저는 WS 업그레이드 요청에도 쿠키를 함께 보낸다)
 */
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppEnv } from '../app';
import type { AppDeps } from '../deps';
import { getSessionUserId, SESSION_COOKIE } from '../modules/auth/session';

/** 로그인이 필요한 라우트에 붙이는 미들웨어. 무효 세션이면 401. */
export function requireAuth(deps: AppDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) return c.json({ error: 'UNAUTHORIZED' }, 401);

    const userId = await getSessionUserId(deps, token);
    if (userId === null) return c.json({ error: 'UNAUTHORIZED' }, 401);

    c.set('userId', userId);
    await next();
  };
}
