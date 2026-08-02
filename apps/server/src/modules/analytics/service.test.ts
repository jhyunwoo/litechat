import { beforeEach, describe, expect, test } from 'bun:test';
import { createApp, type AppType } from '../../app';
import { createTestDeps, type AppDeps } from '../../deps';
import { jsonRequest } from '../../test/helpers';

let deps: AppDeps;
let app: AppType;

beforeEach(() => {
  deps = createTestDeps({ geoipDbPath: '/tmp/litechat-test-missing-geoip.mmdb' });
  app = createApp(deps);
});

describe('analytics parent session recovery', () => {
  test('웹 첫 이벤트가 /session보다 먼저 와도 쿠키 세션과 이벤트를 함께 만든다', async () => {
    const res = await jsonRequest(app, '/api/analytics/event', {
      method: 'POST',
      body: { path: '/login' },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toContain('lc_sid=');

    const session = deps.db
      .query<{ id: string; visitorId: string; platform: string }, []>(
        'SELECT id, visitor_id AS visitorId, platform FROM analytics_sessions',
      )
      .get();
    const event = deps.db
      .query<{ sessionId: string; path: string }, []>(
        'SELECT session_id AS sessionId, path FROM analytics_events',
      )
      .get();

    expect(session).not.toBeNull();
    if (!session) throw new Error('recovered analytics session was not created');
    expect(session?.platform).toBe('web');
    expect(event).toEqual({ sessionId: session.id, path: '/login' });
  });

  test('앱 첫 이벤트가 /session보다 먼저 와도 전달받은 ID로 app 세션을 만든다', async () => {
    const visitorId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const res = await jsonRequest(app, '/api/analytics/event', {
      method: 'POST',
      body: { path: '/', visitorId, sessionId },
    });

    expect(res.status).toBe(204);
    expect(
      deps.db
        .query<{ visitorId: string; platform: string }, [string]>(
          'SELECT visitor_id AS visitorId, platform FROM analytics_sessions WHERE id = ?',
        )
        .get(sessionId),
    ).toEqual({ visitorId, platform: 'app' });
    expect(
      deps.db
        .query<{ count: number }, [string]>(
          'SELECT COUNT(*) AS count FROM analytics_events WHERE session_id = ?',
        )
        .get(sessionId)?.count,
    ).toBe(1);
  });

  test('웹바이탈도 부모 세션이 없으면 먼저 복구한다', async () => {
    const res = await jsonRequest(app, '/api/analytics/vitals', {
      method: 'POST',
      body: { metric: 'LCP', value: 123.4, path: '/' },
    });

    expect(res.status).toBe(204);
    expect(
      deps.db
        .query<{ count: number }, []>(
          `SELECT COUNT(*) AS count
             FROM analytics_vitals v
             JOIN analytics_sessions s ON s.id = v.session_id
            WHERE s.platform = 'web'`,
        )
        .get()?.count,
    ).toBe(1);
  });
});
