/**
 * 클라이언트 IP 추출
 *
 * 배포 환경(Dokploy/Traefik)이 앞단에서 프록시하므로 X-Forwarded-For를 신뢰한다.
 * 여러 프록시를 거치면 콤마로 이어지는데, 맨 앞 값이 원본 클라이언트다.
 * 로컬 개발 등 헤더가 없는 경우에만 Bun의 커넥션 정보로 폴백한다.
 */
import { getConnInfo } from 'hono/bun';
import type { Context } from 'hono';
import type { AppEnv } from '../../app';

export function clientIp(c: Context<AppEnv>): string {
  const forwardedFor = c.req.header('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }

  try {
    return getConnInfo(c).remote.address ?? '0.0.0.0';
  } catch {
    return '0.0.0.0';
  }
}
