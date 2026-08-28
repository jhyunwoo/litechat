/**
 * 클라이언트 주소 확인 — 신뢰할 수 있는 프록시 홉 수를 근거로만 판단한다.
 *
 * X-Forwarded-For와 CF-Connecting-IP는 클라이언트가 그대로 보낼 수 있는 헤더다.
 * 검증 없이 믿으면 요청마다 다른 값을 위조해 레이트리밋 버킷을 무한히 새로 만들 수
 * 있고(자격증명 무차별 대입), 분석 IP·지오 위치도 임의로 오염시킬 수 있다.
 *
 * 규칙:
 *  - XFF는 "각 프록시가 오른쪽에 덧붙인다". 따라서 신뢰 홉이 N개면 오른쪽에서
 *    N번째 항목이 가장 가까운 신뢰 프록시가 실제로 관측한 주소다. 그 왼쪽은 전부
 *    클라이언트가 위조할 수 있으므로 절대 보지 않는다.
 *  - CF-Connecting-IP는 Cloudflare가 실제 엣지일 때만 의미가 있다. 명시적으로
 *    켰을 때만 사용한다.
 *  - 헤더가 없으면 소켓 주소로 폴백한다. 상수 문자열로 폴백하면 모든 클라이언트가
 *    하나의 레이트리밋 버킷을 공유하게 되어 정상 사용자끼리 서로를 차단한다.
 */

export interface ClientAddressOptions {
  /** 앱 앞단의 신뢰할 수 있는 리버스 프록시 수. 0이면 전달 헤더를 전혀 믿지 않는다. */
  trustedProxyHops: number;
  /** Cloudflare가 실제 엣지일 때만 true — CF-Connecting-IP를 권위 있는 값으로 쓴다. */
  trustCfConnectingIp: boolean;
}

/** 소켓 주소조차 없을 때의 최종 폴백 */
const UNKNOWN = 'unknown';

export function resolveClientAddress(
  headers: Headers,
  socketAddress: string | null,
  options: ClientAddressOptions,
): string {
  const trusted = Math.max(0, Math.trunc(options.trustedProxyHops));

  // 신뢰 프록시가 없으면 전달 헤더는 전부 클라이언트 입력이다 — 보지 않는다.
  if (trusted === 0) return socketAddress?.trim() || UNKNOWN;

  if (options.trustCfConnectingIp) {
    const cloudflare = headers.get('cf-connecting-ip')?.trim();
    if (cloudflare) return cloudflare;
  }

  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (hops.length > 0) {
      // 오른쪽에서 trusted번째. 체인이 신뢰 홉보다 짧으면(프록시가 덧붙이기 전 등)
      // 가장 왼쪽으로 클램프한다 — 이 경우에도 위조 항목을 건너뛰지는 못하므로
      // 신뢰 홉 수는 실제 배포와 일치해야 한다.
      const index = Math.max(0, hops.length - trusted);
      const address = hops[index];
      if (address) return address;
    }
  }

  return socketAddress?.trim() || UNKNOWN;
}
