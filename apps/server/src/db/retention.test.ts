import { describe, expect, test } from 'bun:test';
import { createTestDeps } from '../deps';
import { applyRetention } from './retention';

const DAY = 24 * 60 * 60;

function count(db: ReturnType<typeof createTestDeps>['db'], table: string): number {
  return (
    db.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count ?? 0
  );
}

describe('data retention', () => {
  test('deletes expired telemetry, notification, GeoIP, and resolved-report records only', () => {
    const deps = createTestDeps();
    const now = 2_000_000_000;
    const oldTelemetry = now - 91 * DAY;
    const freshTelemetry = now - 89 * DAY;
    const oldGeoip = now - 31 * DAY;
    const freshGeoip = now - 29 * DAY;
    const oldReport = now - 366 * DAY;
    const freshReport = now - 364 * DAY;

    deps.db
      .query(
        `INSERT INTO users (username, password_hash, nickname, created_at)
         VALUES ('alice', 'hash', 'Alice', 1), ('bob', 'hash', 'Bob', 1)`,
      )
      .run();
    deps.db
      .query(
        `INSERT INTO analytics_sessions
           (id, visitor_id, platform, ip, created_at, last_seen_at)
         VALUES
           ('old', 'old-visitor', 'app', '192.0.2.1', ?, ?),
           ('fresh', 'fresh-visitor', 'app', '192.0.2.2', ?, ?)`,
      )
      .run(oldTelemetry, oldTelemetry, freshTelemetry, freshTelemetry);
    deps.db
      .query(
        `INSERT INTO analytics_events (session_id, path, created_at)
         VALUES ('old', '/old', ?), ('fresh', '/fresh', ?)`,
      )
      .run(oldTelemetry, freshTelemetry);
    deps.db
      .query(
        `INSERT INTO analytics_vitals (session_id, metric, value, path, created_at)
         VALUES ('old', 'LCP', 1, '/old', ?), ('fresh', 'LCP', 1, '/fresh', ?)`,
      )
      .run(oldTelemetry, freshTelemetry);
    deps.db
      .query(
        `INSERT INTO notification_log (user_id, channel, sent_at, sent_status)
         VALUES (1, 'expo', ?, 'ok'), (1, 'expo', ?, 'ok')`,
      )
      .run(oldTelemetry, freshTelemetry);
    deps.db
      .query(
        `INSERT INTO geoip_insights (ip, fetched_at, data)
         VALUES ('192.0.2.1', ?, '{}'), ('192.0.2.2', ?, '{}')`,
      )
      .run(oldGeoip, freshGeoip);
    deps.db
      .query(
        `INSERT INTO content_reports
           (reporter_id, reported_user_id, reason, status, created_at, resolved_at)
         VALUES
           (1, 2, 'spam', 'reviewed', 1, ?),
           (1, 2, 'spam', 'open', 1, ?),
           (1, 2, 'spam', 'reviewed', 1, ?)`,
      )
      .run(oldReport, oldReport, freshReport);

    applyRetention(deps.db, now);

    expect(count(deps.db, 'analytics_sessions')).toBe(1);
    expect(count(deps.db, 'analytics_events')).toBe(1);
    expect(count(deps.db, 'analytics_vitals')).toBe(1);
    expect(count(deps.db, 'notification_log')).toBe(1);
    expect(count(deps.db, 'geoip_insights')).toBe(1);
    expect(count(deps.db, 'content_reports')).toBe(2);
    expect(
      deps.db
        .query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM content_reports WHERE status = 'open'",
        )
        .get()?.count,
    ).toBe(1);
  });
});
