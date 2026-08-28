/**
 * 클라이언트 IP 추출 — 레이트리밋과 동일한 신뢰 프록시 규칙을 따른다.
 *
 * 예전에는 X-Forwarded-For의 맨 앞 항목을 그대로 신뢰했는데, 그 값은 클라이언트가
 * 임의로 덧붙일 수 있어 분석 IP·지오 위치·Insights 조회 대상이 전부 오염됐다
 * (LC-SEC-003). 이제 신뢰 홉 수만큼 오른쪽에서 세어 고른다.
 */
import { getConnInfo } from 'hono/bun';
import type { Context } from 'hono';
import type { AppEnv } from '../../app';
import type { AppDeps } from '../../deps';
import { resolveClientAddress } from '../../client-address';

export function clientIp(c: Context<AppEnv>, deps: AppDeps): string {
  let socketAddress: string | null = null;
  try {
    socketAddress = getConnInfo(c).remote.address ?? null;
  } catch {
    socketAddress = null;
  }
  const address = resolveClientAddress(c.req.raw.headers, socketAddress, {
    trustedProxyHops: deps.config.trustedProxyHops,
    trustCfConnectingIp: deps.config.trustCfConnectingIp,
  });
  return address === 'unknown' ? '0.0.0.0' : address;
}
