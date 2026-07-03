/**
 * 앱 조립 스모크 테스트
 */
import { describe, expect, test } from 'bun:test';
import { createApp } from './app';
import { createTestDeps } from './deps';

describe('createApp', () => {
  test('GET /api/health 는 200 { ok: true } 를 반환한다', async () => {
    const app = createApp(createTestDeps());
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test('GET /openapi.json 은 전체 API 경로가 포함된 명세를 반환한다', async () => {
    const app = createApp(createTestDeps());
    const res = await app.request('/openapi.json');
    expect(res.status).toBe(200);
    const spec = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(spec.openapi).toStartWith('3.');
    for (const path of [
      '/api/auth/register',
      '/api/auth/login',
      '/api/friends/search',
      '/api/chat/{id}/messages',
      '/api/push/subscribe',
    ]) {
      expect(Object.keys(spec.paths)).toContain(path);
    }
  });

  test('GET /docs 는 문서 UI HTML을 반환한다', async () => {
    const app = createApp(createTestDeps());
    const res = await app.request('/docs');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });
});
