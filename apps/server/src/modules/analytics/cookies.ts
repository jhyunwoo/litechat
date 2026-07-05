/**
 * 방문자/세션 상관관계 쿠키 — web/lite 공용.
 *
 * lc_vid: 방문자 ID. 로그인 여부와 무관하게 오래 유지된다 (재방문 상관관계용).
 * lc_sid: 세션 ID. 30분 슬라이딩 — 매 요청마다 갱신되므로, "세션이 끊겼는가"는
 *         이 쿠키의 만료 여부로만 판단한다 (별도의 DB 조회 없이 단순하게).
 *
 * auth 모듈의 SESSION_COOKIE와 동일하게 Domain을 .moveto.kr로 두어
 * chat/litechat 두 서브도메인에서 같은 방문자로 상관관계를 맺는다.
 */
import { getCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { AppEnv } from '../../app';
import type { AppDeps } from '../../deps';

export const VISITOR_COOKIE = 'lc_vid';
export const SESSION_COOKIE = 'lc_sid';

// RFC 6265bis(및 Chrome 등 최신 브라우저)가 강제하는 Max-Age 상한이 400일이라
// 그 이상을 주면 hono의 setCookie가 예외를 던진다 — 상한에 맞춰 400일로 둔다.
const VISITOR_MAX_AGE = 60 * 60 * 24 * 400;
const SESSION_MAX_AGE = 60 * 30; // 30분 슬라이딩

function cookieOptions(deps: AppDeps, maxAge: number) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax' as const,
    secure: deps.config.isProduction,
    maxAge,
    ...(deps.config.cookieDomain ? { domain: deps.config.cookieDomain } : {}),
  };
}

export interface VisitorIdentity {
  visitorId: string;
  sessionId: string;
}

/** 요청에 lc_vid 또는 lc_sid 쿠키가 이미 실려 왔는가 (= 브라우저 클라이언트로 판단) */
export function hasVisitorCookies(c: Context<AppEnv>): boolean {
  return getCookie(c, VISITOR_COOKIE) !== undefined || getCookie(c, SESSION_COOKIE) !== undefined;
}

/** 요청의 lc_vid/lc_sid 쿠키를 읽고, 없으면 발급하며 만료를 슬라이딩한다. */
export function ensureVisitorCookies(c: Context<AppEnv>, deps: AppDeps): VisitorIdentity {
  let visitorId = getCookie(c, VISITOR_COOKIE);
  if (!visitorId) {
    visitorId = crypto.randomUUID();
  }
  setCookie(c, VISITOR_COOKIE, visitorId, cookieOptions(deps, VISITOR_MAX_AGE));

  const existingSessionId = getCookie(c, SESSION_COOKIE);
  const sessionId = existingSessionId ?? crypto.randomUUID();
  setCookie(c, SESSION_COOKIE, sessionId, cookieOptions(deps, SESSION_MAX_AGE));

  return { visitorId, sessionId };
}
