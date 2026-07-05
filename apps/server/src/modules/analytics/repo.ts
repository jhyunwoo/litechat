/**
 * analytics_* 테이블 저장소 — 수집 쓰기 + 대시보드 조회 쿼리.
 *
 * admin 모듈은 자체 DB 접근 없이 이 repo를 통해서만 분석 데이터를 읽는다
 * (데이터 소유권은 analytics 모듈에 있다).
 */
import type { Database } from 'bun:sqlite';
import type { GeoResult } from './geoip';

export interface NewSessionInput {
  id: string;
  visitorId: string;
  userId: number | null;
  platform: 'web' | 'lite' | 'app';
  ip: string;
  userAgent: string;
  referrer: string | null;
  geo: GeoResult | null;
}

export class AnalyticsRepo {
  constructor(private db: Database) {}

  /**
   * 세션 upsert — 없으면 새로 만들고, 있으면 last_seen_at만 갱신하며 user_id는
   * (비로그인으로 시작했다가 로그인한 경우를 위해) 아직 NULL일 때만 채운다.
   *
   * "새 세션인가"를 클라이언트 신호(body.sessionId 유무)로 판단하지 않는다 — app은
   * 항상 자기 sessionId를 보내므로 그 신호로는 최초 여부를 구분할 수 없다. 대신 매번
   * 이 upsert를 그대로 호출해 SQL의 충돌 처리에 맡긴다(호출 비용은 PK 조회 1건뿐).
   */
  insertSession(input: NewSessionInput): void {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .query(
        `INSERT INTO analytics_sessions
           (id, visitor_id, user_id, platform, ip, user_agent, referrer,
            geo_country, geo_region, geo_city, geo_lat, geo_lon, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           last_seen_at = excluded.last_seen_at,
           user_id = COALESCE(analytics_sessions.user_id, excluded.user_id)`,
      )
      .run(
        input.id,
        input.visitorId,
        input.userId,
        input.platform,
        input.ip,
        input.userAgent,
        input.referrer,
        input.geo?.country ?? null,
        input.geo?.region ?? null,
        input.geo?.city ?? null,
        input.geo?.lat ?? null,
        input.geo?.lon ?? null,
        now,
        now,
      );
  }

  insertEvent(sessionId: string, path: string): void {
    this.db
      .query('INSERT INTO analytics_events (session_id, path, created_at) VALUES (?, ?, ?)')
      .run(sessionId, path, Math.floor(Date.now() / 1000));
  }

  insertVitals(sessionId: string, metric: string, value: number, path: string): void {
    this.db
      .query(
        'INSERT INTO analytics_vitals (session_id, metric, value, path, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(sessionId, metric, value, path, Math.floor(Date.now() / 1000));
  }

  // ── 대시보드 조회 ─────────────────────────────────────────

  overview(sinceDays: number): {
    sessions: number;
    visitors: number;
    loggedInSessions: number;
    byPlatform: { platform: string; count: number }[];
  } {
    const since = Math.floor(Date.now() / 1000) - sinceDays * 86400;
    const totals = this.db
      .query<{ sessions: number; visitors: number; loggedInSessions: number }, [number]>(
        `SELECT COUNT(*) AS sessions,
                COUNT(DISTINCT visitor_id) AS visitors,
                COUNT(*) FILTER (WHERE user_id IS NOT NULL) AS loggedInSessions
         FROM analytics_sessions WHERE created_at >= ?`,
      )
      .get(since) ?? { sessions: 0, visitors: 0, loggedInSessions: 0 };

    const byPlatform = this.db
      .query<{ platform: string; count: number }, [number]>(
        `SELECT platform, COUNT(*) AS count FROM analytics_sessions
         WHERE created_at >= ? GROUP BY platform`,
      )
      .all(since);

    return { ...totals, byPlatform };
  }

  timeseries(days: number): { day: string; sessions: number; events: number }[] {
    const since = Math.floor(Date.now() / 1000) - days * 86400;
    // YYYY-MM-DD 문자열은 사전식 정렬이 곧 날짜순 정렬이라 별도 변환이 필요 없다.
    return this.db
      .query<{ day: string; sessions: number; events: number }, [number, number]>(
        `SELECT s.day, s.sessions, COALESCE(e.events, 0) AS events
         FROM (
           SELECT strftime('%Y-%m-%d', created_at, 'unixepoch') AS day, COUNT(*) AS sessions
           FROM analytics_sessions WHERE created_at >= ? GROUP BY day
         ) s
         LEFT JOIN (
           SELECT strftime('%Y-%m-%d', created_at, 'unixepoch') AS day, COUNT(*) AS events
           FROM analytics_events WHERE created_at >= ? GROUP BY day
         ) e ON e.day = s.day
         ORDER BY s.day`,
      )
      .all(since, since);
  }

  geoPoints(days: number): { lat: number; lon: number; city: string | null; country: string | null; count: number }[] {
    const since = Math.floor(Date.now() / 1000) - days * 86400;
    return this.db
      .query<
        { lat: number; lon: number; city: string | null; country: string | null; count: number },
        [number]
      >(
        `SELECT geo_lat AS lat, geo_lon AS lon, geo_city AS city, geo_country AS country, COUNT(*) AS count
         FROM analytics_sessions
         WHERE created_at >= ? AND geo_lat IS NOT NULL
         GROUP BY geo_lat, geo_lon, geo_city, geo_country`,
      )
      .all(since);
  }

  userVisitCounts(): {
    userId: number;
    username: string;
    nickname: string;
    sessionCount: number;
    lastSeenAt: number;
  }[] {
    return this.db
      .query<
        { userId: number; username: string; nickname: string; sessionCount: number; lastSeenAt: number },
        []
      >(
        `SELECT u.id AS userId, u.username, u.nickname,
                COUNT(a.id) AS sessionCount, MAX(a.last_seen_at) AS lastSeenAt
         FROM analytics_sessions a
         JOIN users u ON u.id = a.user_id
         GROUP BY u.id
         ORDER BY sessionCount DESC`,
      )
      .all();
  }

  vitalsTrend(
    metric: string,
    days: number,
  ): { day: string; avg: number; p75: number; count: number }[] {
    const since = Math.floor(Date.now() / 1000) - days * 86400;
    // SQLite에는 PERCENTILE_CONT가 없으므로, 윈도우 함수로 정렬 순위를 매겨 75% 지점을 뽑는다.
    return this.db
      .query<{ day: string; avg: number; p75: number; count: number }, [string, number]>(
        `WITH v AS (
           SELECT strftime('%Y-%m-%d', created_at, 'unixepoch') AS day,
                  value,
                  ROW_NUMBER() OVER (
                    PARTITION BY strftime('%Y-%m-%d', created_at, 'unixepoch') ORDER BY value
                  ) AS rn,
                  COUNT(*) OVER (
                    PARTITION BY strftime('%Y-%m-%d', created_at, 'unixepoch')
                  ) AS cnt
           FROM analytics_vitals
           WHERE metric = ? AND created_at >= ?
         )
         SELECT day, AVG(value) AS avg, COUNT(*) AS count,
                MAX(CASE WHEN rn = CAST(cnt * 0.75 AS INTEGER) + 1 THEN value END) AS p75
         FROM v
         GROUP BY day
         ORDER BY day`,
      )
      .all(metric, since);
  }
}
