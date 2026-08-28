import { describe, expect, test } from 'bun:test';
import { parseClientFrame } from '@litechat/types';
import { createApp } from './app';
import { createTestDeps } from './deps';
import { resolveClientAddress } from './client-address';

describe('release security controls', () => {
  test('login is rate-limited with Retry-After', async () => {
    const app = createApp(createTestDeps());
    let response!: Response;
    for (let attempt = 0; attempt < 21; attempt += 1) {
      response = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'nobody', password: 'password123' }),
      });
    }
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  test('client WebSocket frames are strict and size bounded', () => {
    expect(parseClientFrame('{"t":"p"}')).toEqual({ t: 'p' });
    expect(parseClientFrame('{"t":"p","extra":true}')).toBeNull();
    expect(parseClientFrame('{"t":"m","c":"1","k":"t","x":"hi","i":"tmp"}')).toBeNull();
    expect(
      parseClientFrame(JSON.stringify({ t: 'm', c: 1, k: 't', x: 'a'.repeat(9000), i: 'tmp' })),
    ).toBeNull();
  });

  /**
   * LC-SEC-001 — 클라이언트가 보낸 엣지 헤더(cf-connecting-ip / x-forwarded-for)를
   * 그대로 믿으면 요청마다 새 레이트리밋 버킷이 생겨 자격증명 무차별 대입이 무제한이 된다.
   * 관리자 로그인(5회/15분)이 가장 위험하므로 이 경로로 회귀 테스트를 고정한다.
   */
  test('spoofed cf-connecting-ip cannot reset the admin-login rate limit', async () => {
    const app = createApp(createTestDeps());
    let response!: Response;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      response = await app.request('/api/admin/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // 공격자가 매 요청 다른 엣지 IP를 위조한다. 신뢰 프록시(Traefik)는 실제
          // 피어 주소를 오른쪽에 덧붙이므로, 위조 항목은 전부 그 왼쪽에 남는다.
          'cf-connecting-ip': `10.0.0.${attempt}`,
          'x-forwarded-for': `10.1.1.${attempt}, 203.0.113.7`,
        },
        body: JSON.stringify({ username: 'admin', password: `guess-${attempt}` }),
      });
    }
    expect(response.status).toBe(429);
  });

  test('spoofed x-forwarded-for cannot reset the login rate limit', async () => {
    const app = createApp(createTestDeps());
    let response!: Response;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      response = await app.request('/api/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // 위조 항목을 몇 개를 덧붙이든 마지막 항목(신뢰 프록시가 관측한 실제 주소)만 쓰인다.
          'x-forwarded-for': `198.51.100.${attempt}, 192.0.2.${attempt}, 203.0.113.7`,
        },
        body: JSON.stringify({ username: 'nobody', password: 'password123' }),
      });
    }
    expect(response.status).toBe(429);
  });

  /**
   * LC-SEC-003 — 신뢰 홉 수만큼만 오른쪽에서 세어 클라이언트 주소를 고른다.
   * 클라이언트가 앞에 임의 항목을 덧붙여도 결과가 바뀌면 안 된다.
   */
  describe('resolveClientAddress', () => {
    const trustOneHop = { trustedProxyHops: 1, trustCfConnectingIp: false };

    test('uses the address the nearest trusted proxy observed, not the leftmost claim', () => {
      const headers = new Headers({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9' });
      expect(resolveClientAddress(headers, null, trustOneHop)).toBe('203.0.113.9');
    });

    test('client-prepended entries cannot change the result', () => {
      const spoofed = new Headers({ 'x-forwarded-for': 'evil, 9.9.9.9, 203.0.113.9' });
      expect(resolveClientAddress(spoofed, null, trustOneHop)).toBe('203.0.113.9');
    });

    test('ignores cf-connecting-ip unless the edge is explicitly trusted', () => {
      const headers = new Headers({
        'cf-connecting-ip': '1.2.3.4',
        'x-forwarded-for': 'spoofed, 203.0.113.9',
      });
      expect(resolveClientAddress(headers, null, trustOneHop)).toBe('203.0.113.9');
      expect(
        resolveClientAddress(headers, null, { trustedProxyHops: 1, trustCfConnectingIp: true }),
      ).toBe('1.2.3.4');
    });

    test('falls back to the socket address instead of a shared "unknown" bucket', () => {
      expect(resolveClientAddress(new Headers(), '192.0.2.50', trustOneHop)).toBe('192.0.2.50');
    });

    test('with no trusted proxy, forwarded headers are ignored entirely', () => {
      const headers = new Headers({ 'x-forwarded-for': '1.2.3.4' });
      const direct = { trustedProxyHops: 0, trustCfConnectingIp: false };
      expect(resolveClientAddress(headers, '192.0.2.50', direct)).toBe('192.0.2.50');
    });
  });

  /** LC-SEC-005 — CSP가 실제로 실려야 한다 (hono secureHeaders 기본값에는 없다). */
  test('responses carry a restrictive Content-Security-Policy', async () => {
    const app = createApp(createTestDeps());
    const csp = (await app.request('/api/health')).headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    // 와일드카드나 인라인 스크립트 허용이 슬며시 들어오는 것을 막는다.
    expect(csp).not.toContain("script-src 'self' *");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-eval'/);
  });

  test('docs CDN origin is absent from CSP when API docs are disabled', async () => {
    const app = createApp(createTestDeps({ exposeApiDocs: false }));
    const csp = (await app.request('/api/health')).headers.get('content-security-policy') ?? '';
    expect(csp).not.toContain('cdn.jsdelivr.net');
  });

  /** LC-SEC-006 — 인증 없는 분석 수집 엔드포인트에도 상한이 있어야 한다. */
  test('unauthenticated analytics ingest is rate limited', async () => {
    const app = createApp(createTestDeps());
    let response!: Response;
    for (let attempt = 0; attempt < 245; attempt += 1) {
      response = await app.request('/api/analytics/event', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: '/', visitorId: crypto.randomUUID(), sessionId: crypto.randomUUID() }),
      });
    }
    expect(response.status).toBe(429);
  });
});
