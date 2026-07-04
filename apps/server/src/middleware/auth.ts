/**
 * 인증 미들웨어 — 세션 토큰을 검증하고 c.var.userId를 채운다.
 *
 * 토큰 출처는 두 가지를 지원한다:
 *   1. Authorization: Bearer <token>  — 네이티브 앱 (쿠키 저장소가 없다)
 *   2. lc_sess 세션 쿠키               — 웹 브라우저
 *
 * REST API와 WebSocket 업그레이드 요청 모두 이 미들웨어를 통과한다.
 * (브라우저는 WS 업그레이드 요청에도 쿠키를, RN WebSocket은 헤더를 보낸다)
 */
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppEnv } from '../app';
import type { AppDeps } from '../deps';
import { getSessionUserId, SESSION_COOKIE } from '../modules/auth/session';

/** 요청에서 세션 토큰을 추출한다 — Bearer 헤더 우선, 쿠키 폴백. */
export function tokenFromRequest(c: Context<AppEnv>): string | undefined {
  const header = c.req.header('Authorization');
  if (header) {
    const [scheme, token] = header.split(' ');
    if (scheme === 'Bearer' && token) return token;
    return undefined; // 형식이 어긋난 Authorization 헤더는 쿠키로 폴백하지 않고 거부한다
  }
  return getCookie(c, SESSION_COOKIE);
}

/** 로그인이 필요한 라우트에 붙이는 미들웨어. 무효 세션이면 401. */
export function requireAuth(deps: AppDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = tokenFromRequest(c);
    if (!token) return c.json({ error: 'UNAUTHORIZED' }, 401);

    const userId = await getSessionUserId(deps, token);
    if (userId === null) return c.json({ error: 'UNAUTHORIZED' }, 401);

    c.set('userId', userId);
    await next();
  };
}
