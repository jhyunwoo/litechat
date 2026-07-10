/**
 * analytics_* 테이블 저장소 — 수집 쓰기 + 대시보드 조회 쿼리.
 *
 * admin 모듈은 자체 DB 접근 없이 이 repo를 통해서만 분석 데이터를 읽는다
 * (데이터 소유권은 analytics 모듈에 있다).
 */
import type { Database } from 'bun:sqlite';
import type { GeoResult } from './geoip';
import type { InsightsRow } from './insights';

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

/** 접속 기록 조회 필터/정렬/페이지 — 정렬 컬럼은 화이트리스트로만 받는다 */
export interface SessionListFilter {
  userId?: number;
  platform?: string;
  /** 부분 일치 (LIKE) */
  ip?: string;
  /** unix epoch 초 범위 */
  from?: number;
  to?: number;
  sort: 'created_at' | 'last_seen_at';
  dir: 'asc' | 'desc';
  limit: number;
  offset: number;
}

export interface SessionRow {
  id: string;
  visitorId: string;
  userId: number | null;
  username: string | null;
  nickname: string | null;
  platform: string;
  ip: string;
  userAgent: string;
  referrer: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
  createdAt: number;
  lastSeenAt: number;
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

  /** 지도 진단 — 최근 기간 세션 중 위치를 확보한 비율을 파악한다. */
  geoDiagnostics(days: number): { total: number; withGeo: number } {
    const since = Math.floor(Date.now() / 1000) - days * 86400;
    return (
      this.db
        .query<{ total: number; withGeo: number }, [number]>(
          `SELECT COUNT(*) AS total,
                  COUNT(*) FILTER (WHERE geo_lat IS NOT NULL) AS withGeo
           FROM analytics_sessions WHERE created_at >= ?`,
        )
        .get(since) ?? { total: 0, withGeo: 0 }
    );
  }

  /**
   * 위치 조회에 실패한(geo_lat IS NULL) IP를 최근순으로 표본 추출한다.
   * IP가 사설(10./172./192.168.)이면 프록시 헤더 문제, 공인인데도 실패면 mmdb 문제로
   * 대시보드에서 원인을 구분할 수 있다.
   */
  ungeolocatedIps(days: number, limit: number): { ip: string; count: number; lastAt: number }[] {
    const since = Math.floor(Date.now() / 1000) - days * 86400;
    return this.db
      .query<{ ip: string; count: number; lastAt: number }, [number, number]>(
        `SELECT ip, COUNT(*) AS count, MAX(created_at) AS lastAt
         FROM analytics_sessions
         WHERE created_at >= ? AND geo_lat IS NULL
         GROUP BY ip
         ORDER BY lastAt DESC
         LIMIT ?`,
      )
      .all(since, limit);
  }

  /**
   * 접속 기록 데이터 탐색기 — 개별 세션 행을 사용자 정보와 함께 필터/정렬/페이지로 나열한다.
   * WHERE 절은 채워진 필터만 조건부로 조립하고, 정렬은 타입으로 제한된 화이트리스트 값만
   * 문자열에 넣는다 (사용자 입력을 SQL에 직접 잇지 않는다).
   */
  listSessions(filter: SessionListFilter): { rows: SessionRow[]; total: number } {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.userId !== undefined) {
      where.push('s.user_id = ?');
      params.push(filter.userId);
    }
    if (filter.platform) {
      where.push('s.platform = ?');
      params.push(filter.platform);
    }
    if (filter.ip) {
      where.push('s.ip LIKE ?');
      params.push(`%${filter.ip}%`);
    }
    if (filter.from !== undefined) {
      where.push('s.created_at >= ?');
      params.push(filter.from);
    }
    if (filter.to !== undefined) {
      where.push('s.created_at <= ?');
      params.push(filter.to);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total =
      this.db
        .query<{ n: number }, (string | number)[]>(
          `SELECT COUNT(*) AS n FROM analytics_sessions s ${whereSql}`,
        )
        .get(...params)?.n ?? 0;

    const rows = this.db
      .query<SessionRow, (string | number)[]>(
        `SELECT s.id, s.visitor_id AS visitorId, s.user_id AS userId,
                u.username, u.nickname,
                s.platform, s.ip, s.user_agent AS userAgent, s.referrer,
                s.geo_country AS country, s.geo_region AS region, s.geo_city AS city,
                s.geo_lat AS lat, s.geo_lon AS lon,
                s.created_at AS createdAt, s.last_seen_at AS lastSeenAt
         FROM analytics_sessions s
         LEFT JOIN users u ON u.id = s.user_id
         ${whereSql}
         ORDER BY s.${filter.sort} ${filter.dir === 'asc' ? 'ASC' : 'DESC'}
         LIMIT ? OFFSET ?`,
      )
      .all(...params, filter.limit, filter.offset);

    return { rows, total };
  }

  // ── GeoIP2 Insights 캐시 ─────────────────────────────────

  getInsights(ip: string): InsightsRow | null {
    return (
      this.db
        .query<InsightsRow, [string]>(
          `SELECT ip, fetched_at AS fetchedAt, lat, lon, accuracy_radius AS accuracyRadius,
                  city, region, country, isp, organization, user_type AS userType, data
           FROM geoip_insights WHERE ip = ?`,
        )
        .get(ip) ?? null
    );
  }

  upsertInsights(row: InsightsRow): void {
    this.db
      .query(
        `INSERT INTO geoip_insights
           (ip, fetched_at, lat, lon, accuracy_radius, city, region, country,
            isp, organization, user_type, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (ip) DO UPDATE SET
           fetched_at = excluded.fetched_at, lat = excluded.lat, lon = excluded.lon,
           accuracy_radius = excluded.accuracy_radius, city = excluded.city,
           region = excluded.region, country = excluded.country, isp = excluded.isp,
           organization = excluded.organization, user_type = excluded.user_type,
           data = excluded.data`,
      )
      .run(
        row.ip,
        row.fetchedAt,
        row.lat,
        row.lon,
        row.accuracyRadius,
        row.city,
        row.region,
        row.country,
        row.isp,
        row.organization,
        row.userType,
        row.data,
      );
  }

  // ── Insights 상시 수집(워치) ─────────────────────────────

  addInsightsWatch(userId: number): void {
    this.db
      .query('INSERT INTO insights_watch (user_id, created_at) VALUES (?, ?) ON CONFLICT DO NOTHING')
      .run(userId, Math.floor(Date.now() / 1000));
  }

  removeInsightsWatch(userId: number): void {
    this.db.query('DELETE FROM insights_watch WHERE user_id = ?').run(userId);
  }

  isInsightsWatched(userId: number): boolean {
    return (
      this.db.query<{ user_id: number }, [number]>('SELECT user_id FROM insights_watch WHERE user_id = ?').get(userId) !==
      null
    );
  }

  listInsightsWatch(): number[] {
    return this.db
      .query<{ userId: number }, []>('SELECT user_id AS userId FROM insights_watch ORDER BY created_at')
      .all()
      .map((row) => row.userId);
  }

  /** 사용자의 최근 고유 IP — 워치 등록 직후 백필 대상 (최근 접속 순) */
  recentUserIps(userId: number, limit: number): string[] {
    return this.db
      .query<{ ip: string }, [number, number]>(
        `SELECT ip FROM analytics_sessions WHERE user_id = ?
         GROUP BY ip ORDER BY MAX(last_seen_at) DESC LIMIT ?`,
      )
      .all(userId, limit)
      .map((row) => row.ip);
  }

  /** 사용자의 접속 IP들에 대해 저장된 Insights 전부 — 세션 ip는 ::ffff: 접두사가 붙을 수 있어 정규화해 조인한다 */
  insightsForUser(userId: number): InsightsRow[] {
    return this.db
      .query<InsightsRow, [number]>(
        `SELECT gi.ip, gi.fetched_at AS fetchedAt, gi.lat, gi.lon,
                gi.accuracy_radius AS accuracyRadius, gi.city, gi.region, gi.country,
                gi.isp, gi.organization, gi.user_type AS userType, gi.data
         FROM geoip_insights gi
         WHERE gi.ip IN (
           SELECT DISTINCT REPLACE(ip, '::ffff:', '') FROM analytics_sessions WHERE user_id = ?
         )
         ORDER BY gi.fetched_at DESC`,
      )
      .all(userId);
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
