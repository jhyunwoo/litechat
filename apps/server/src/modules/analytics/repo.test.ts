/**
 * AnalyticsRepo 단위 테스트 — 접속 기록 탐색기(listSessions)와 Insights 캐시
 */
import { describe, expect, test } from 'bun:test';
import { openTestDatabase } from '../../db/database';
import { AnalyticsRepo, type NewSessionInput, type SessionListFilter } from './repo';

function seed(db: ReturnType<typeof openTestDatabase>): AnalyticsRepo {
  const repo = new AnalyticsRepo(db);
  db.exec(
    `INSERT INTO users (username, password_hash, nickname, created_at)
     VALUES ('alice', 'h', 'Alice', 0), ('bob', 'h', 'Bob', 0)`,
  );
  const rows: [string, number | null, 'web' | 'lite' | 'app', string][] = [
    ['s1', 1, 'web', '1.1.1.1'],
    ['s2', 1, 'lite', '2.2.2.2'],
    ['s3', 2, 'app', '1.1.9.9'],
    ['s4', null, 'web', '3.3.3.3'],
  ];
  rows.forEach(([id, userId, platform, ip], index) => {
    db.query(
      `INSERT INTO analytics_sessions
         (id, visitor_id, user_id, platform, ip, user_agent, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, 'UA', ?, ?)`,
    ).run(id, `v-${id}`, userId, platform, ip, 1000 + index, 2000 + index);
  });
  return repo;
}

const base: SessionListFilter = {
  sort: 'created_at',
  dir: 'desc',
  limit: 50,
  offset: 0,
};

describe('listSessions', () => {
  test('전체 나열 + 사용자 조인 + 최신순 정렬', () => {
    const repo = seed(openTestDatabase());
    const { rows, total } = repo.listSessions(base);
    expect(total).toBe(4);
    expect(rows.map((r) => r.id)).toEqual(['s4', 's3', 's2', 's1']);
    expect(rows[3]?.nickname).toBe('Alice');
    expect(rows[0]?.nickname).toBeNull(); // 비로그인 세션
  });

  test('사용자/플랫폼/IP 부분일치/기간 필터', () => {
    const repo = seed(openTestDatabase());
    expect(repo.listSessions({ ...base, userId: 1 }).total).toBe(2);
    expect(repo.listSessions({ ...base, platform: 'web' }).total).toBe(2);
    expect(repo.listSessions({ ...base, ip: '1.1' }).total).toBe(2); // 1.1.1.1 + 1.1.9.9
    expect(repo.listSessions({ ...base, from: 1001, to: 1002 }).total).toBe(2);
  });

  test('페이지네이션 — limit/offset과 total이 일관된다', () => {
    const repo = seed(openTestDatabase());
    const page1 = repo.listSessions({ ...base, limit: 3, offset: 0 });
    const page2 = repo.listSessions({ ...base, limit: 3, offset: 3 });
    expect(page1.rows.length).toBe(3);
    expect(page2.rows.length).toBe(1);
    expect(page1.total).toBe(4);
    expect(page2.rows[0]?.id).toBe('s1');
  });
});

describe('geo_accuracy_km — 지도 미터 기반 반경의 데이터 소스', () => {
  /** GeoIP 조회 결과가 있는 세션 입력 헬퍼 — accuracyKm만 케이스별로 바꾼다 */
  const geoInput = (
    id: string,
    accuracyKm: number | null,
    lat = 37.5,
  ): NewSessionInput => ({
    id,
    visitorId: `v-${id}`,
    userId: null,
    platform: 'web',
    ip: '5.5.5.5',
    userAgent: 'UA',
    referrer: null,
    geo: { country: 'KR', region: '11', city: 'Seoul', lat, lon: 127.0, accuracyKm },
  });

  test('insertSession이 accuracyKm을 저장하고 listSessions가 반환한다 (레거시 행은 null)', () => {
    const db = openTestDatabase();
    const repo = seed(db); // s1~s4 — geo 없이 삽입된 레거시 행
    repo.insertSession(geoInput('s-geo', 10));

    const withGeo = repo.listSessions({ ...base, ip: '5.5.5.5' });
    expect(withGeo.rows[0]?.accuracyKm).toBe(10);

    const legacy = repo.listSessions({ ...base, ip: '1.1.1.1' });
    expect(legacy.rows[0]?.accuracyKm).toBeNull();
  });

  test('geoPoints — 같은 지점 그룹은 MAX(accuracyKm), 정확도가 전혀 없으면 null', () => {
    const repo = new AnalyticsRepo(openTestDatabase());
    repo.insertSession(geoInput('g1', 10));
    repo.insertSession(geoInput('g2', 50)); // 같은 좌표 — 보수적으로 큰 반경을 채택
    repo.insertSession(geoInput('g3', null, 35.1)); // 다른 좌표, 정확도 없음

    const points = repo.geoPoints(30);
    const seoul = points.find((p) => p.lat === 37.5);
    const other = points.find((p) => p.lat === 35.1);
    expect(seoul?.count).toBe(2);
    expect(seoul?.accuracyKm).toBe(50);
    expect(other?.count).toBe(1);
    expect(other?.accuracyKm).toBeNull();
  });
});

describe('geoip_insights 캐시', () => {
  test('upsert 후 조회, 같은 IP 재-upsert는 갱신된다', () => {
    const repo = new AnalyticsRepo(openTestDatabase());
    expect(repo.getInsights('9.9.9.9')).toBeNull();

    repo.upsertInsights({
      ip: '9.9.9.9',
      fetchedAt: 100,
      lat: 37.5,
      lon: 127.0,
      accuracyRadius: 20,
      city: 'Seoul',
      region: '11',
      country: 'KR',
      isp: 'ISP',
      organization: 'Org',
      userType: 'residential',
      data: '{}',
    });
    const first = repo.getInsights('9.9.9.9');
    expect(first?.accuracyRadius).toBe(20);
    expect(first?.fetchedAt).toBe(100);

    repo.upsertInsights({ ...first!, fetchedAt: 200, accuracyRadius: 5 });
    const second = repo.getInsights('9.9.9.9');
    expect(second?.fetchedAt).toBe(200);
    expect(second?.accuracyRadius).toBe(5);
  });
});

describe('insights_watch', () => {
  const insightsRow = (ip: string, fetchedAt: number) => ({
    ip, fetchedAt, lat: 0, lon: 0, accuracyRadius: null,
    city: null, region: null, country: null, isp: null, organization: null, userType: null,
    data: '{}',
  });

  test('등록/해제/조회 — 중복 등록은 무시된다', () => {
    const repo = seed(openTestDatabase());
    expect(repo.isInsightsWatched(1)).toBe(false);

    repo.addInsightsWatch(1);
    repo.addInsightsWatch(1); // 중복
    repo.addInsightsWatch(2);
    expect(repo.isInsightsWatched(1)).toBe(true);
    expect(repo.listInsightsWatch()).toEqual([1, 2]);

    repo.removeInsightsWatch(1);
    expect(repo.isInsightsWatched(1)).toBe(false);
    expect(repo.listInsightsWatch()).toEqual([2]);
  });

  test('recentUserIps — 고유 IP를 최근 접속 순으로 제한 개수만큼', () => {
    const db = openTestDatabase();
    const repo = seed(db);
    // s1(1.1.1.1, last_seen 2000), s2(2.2.2.2, 2001) 모두 user 1 — s2가 최신
    expect(repo.recentUserIps(1, 10)).toEqual(['2.2.2.2', '1.1.1.1']);
    expect(repo.recentUserIps(1, 1)).toEqual(['2.2.2.2']);
    expect(repo.recentUserIps(999, 10)).toEqual([]);
  });

  test('insightsForUser — 세션의 ::ffff: IP도 정규화해 조인한다', () => {
    const db = openTestDatabase();
    const repo = seed(db);
    db.query(
      `INSERT INTO analytics_sessions
         (id, visitor_id, user_id, platform, ip, user_agent, created_at, last_seen_at)
       VALUES ('s5', 'v-s5', 1, 'web', '::ffff:4.4.4.4', 'UA', 1010, 2010)`,
    ).run();
    repo.upsertInsights(insightsRow('1.1.1.1', 100)); // user 1의 s1
    repo.upsertInsights(insightsRow('4.4.4.4', 300)); // user 1의 s5 (mapped)
    repo.upsertInsights(insightsRow('3.3.3.3', 200)); // 비로그인 세션 — 제외

    expect(repo.insightsForUser(1).map((r) => r.ip)).toEqual(['4.4.4.4', '1.1.1.1']);
    expect(repo.insightsForUser(2)).toEqual([]);
  });
});
