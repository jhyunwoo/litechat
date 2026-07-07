/**
 * 관리자 API 클라이언트 — /api/admin/* 전용 얇은 fetch 래퍼.
 *
 * apps/web처럼 서버의 AppType 전체를 hc로 끌어오지 않는다 — 대시보드가 쓰는
 * 엔드포인트는 6개뿐이라, 전체 채팅 API 타입 그래프에 결합시키지 않기 위해서다.
 * 쿠키(lc_admin_sess) 기반 인증이므로 모든 요청에 credentials: 'include'가 필요하다.
 */

export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let code = 'INTERNAL';
    try {
      code = ((await res.json()) as { error?: string }).error ?? code;
    } catch {
      /* JSON이 아닌 오류 응답은 기본 코드 유지 */
    }
    throw new ApiFailure(res.status, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface AdminMe {
  admin: { id: number; username: string };
}

export interface Overview {
  sessions: number;
  visitors: number;
  loggedInSessions: number;
  byPlatform: { platform: string; count: number }[];
}

export interface TimeseriesPoint {
  day: string;
  sessions: number;
  events: number;
}

export interface GeoPoint {
  lat: number;
  lon: number;
  city: string | null;
  country: string | null;
  count: number;
}

export interface GeoStatus {
  /** GeoIP DB 로드 상태 */
  dbStatus: 'unopened' | 'ok' | 'missing' | 'error';
  /** 서버가 기대하는 mmdb 경로 (파일 배치 위치 확인용) */
  dbPath: string;
  /** 최근 기간 전체 세션 수 */
  total: number;
  /** 그중 위치를 확보한 세션 수 */
  withGeo: number;
  /** 위치 조회에 실패한 IP 표본 (최근순) */
  ungeolocated: { ip: string; count: number; lastAt: number }[];
}

export interface UserVisit {
  userId: number;
  username: string;
  nickname: string;
  sessionCount: number;
  lastSeenAt: number;
}

export interface VitalsPoint {
  day: string;
  avg: number;
  p75: number;
  count: number;
}

export const adminApi = {
  login: (username: string, password: string) =>
    request<{ ok: true }>('/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request<{ ok: true }>('/logout', { method: 'POST' }),
  me: () => request<AdminMe>('/me'),
  overview: (days = 30) => request<Overview>(`/overview?days=${days}`),
  timeseries: (days = 30) => request<TimeseriesPoint[]>(`/timeseries?days=${days}`),
  geo: (days = 30) => request<GeoPoint[]>(`/geo?days=${days}`),
  geoStatus: (days = 30) => request<GeoStatus>(`/geo/status?days=${days}`),
  usersVisits: () => request<UserVisit[]>('/users/visits'),
  vitals: (metric = 'LCP', days = 30) => request<VitalsPoint[]>(`/vitals?metric=${metric}&days=${days}`),
};
