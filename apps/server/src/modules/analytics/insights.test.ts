/**
 * normalizeIp 단위 테스트
 *
 * Insights는 쿼리당 과금되는 API다. 세션 IP는 클라이언트가 보낸 X-Forwarded-For에서
 * 오므로(ip.ts), 형식이 잘못된 값이 그대로 API로 나가지 않도록 여기서 걸러야 한다.
 * 호출부(admin/routes.ts, insights-collector.ts)는 빈 문자열을 "무효"로 취급한다.
 */
import { describe, expect, test } from 'bun:test';
import { normalizeIp } from './insights';

describe('normalizeIp', () => {
  test('IPv4/IPv6를 그대로 통과시킨다', () => {
    expect(normalizeIp('1.1.1.1')).toBe('1.1.1.1');
    expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
    expect(normalizeIp('::1')).toBe('::1');
  });

  test('IPv6-mapped IPv4를 IPv4로 정규화한다 — 캐시 키를 하나로 모은다', () => {
    expect(normalizeIp('::ffff:4.4.4.4')).toBe('4.4.4.4');
    expect(normalizeIp('::FFFF:4.4.4.4')).toBe('4.4.4.4');
  });

  test('IP가 아닌 값은 빈 문자열 — 유료 API로 나가지 못하게 막는다', () => {
    for (const bad of ['', 'not-an-ip', '8.8.8.8.8', '999.1.1.1', '1.1.1.1 ', '../../etc', '%00']) {
      expect(normalizeIp(bad)).toBe('');
    }
  });
});
