import type { MiddlewareHandler } from 'hono';
import { getConnInfo } from 'hono/bun';
import type { Context } from 'hono';
import { resolveClientAddress } from '../client-address';
import type { AppDeps } from '../deps';

/**
 * 레이트리밋 키로 쓸 클라이언트 주소.
 *
 * 전달 헤더를 검증 없이 믿으면 공격자가 매 요청 다른 값을 보내 버킷을 새로 만들 수
 * 있어 로그인/관리자 로그인 무차별 대입 방어가 완전히 무력화된다(LC-SEC-001).
 * 신뢰 프록시 수를 근거로만 주소를 고른다.
 */
function clientAddress(c: Context, deps: AppDeps): string {
  let socketAddress: string | null = null;
  try {
    socketAddress = getConnInfo(c).remote.address ?? null;
  } catch {
    // 테스트의 app.request()처럼 소켓이 없는 환경 — 헤더 기반 판단으로 넘어간다.
  }
  return resolveClientAddress(c.req.raw.headers, socketAddress, {
    trustedProxyHops: deps.config.trustedProxyHops,
    trustCfConnectingIp: deps.config.trustCfConnectingIp,
  });
}

/** Redis-backed fixed-window limiter. Production instances share the same budget. */
export function rateLimit(
  deps: AppDeps,
  options: { name: string; limit: number; windowSeconds: number },
): MiddlewareHandler {
  return async (c, next) => {
    const address = clientAddress(c, deps);
    const key = `rate:${options.name}:${address}`;
    const { count, retryAfter } = await deps.kv.increment(key, options.windowSeconds);
    c.header('X-RateLimit-Limit', String(options.limit));
    c.header('X-RateLimit-Remaining', String(Math.max(0, options.limit - count)));
    if (count > options.limit) {
      c.header('Retry-After', String(retryAfter));
      return c.json({ error: 'RATE_LIMITED' }, 429);
    }
    await next();
  };
}
