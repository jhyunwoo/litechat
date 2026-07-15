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

export interface AdminConfig {
  /** Google Maps JS API 키 — 비어 있으면 지도를 표시하지 않는다 */
  googleMapsApiKey: string;
  /** AdvancedMarker 렌더링용 Map ID */
  googleMapsMapId: string;
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

export interface GeoipRefreshInfo {
  at: number;
  ok: boolean;
  error?: string;
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
  /** MaxMind 자격 증명이 설정돼 주간 자동 갱신이 켜져 있는지 */
  autoRefresh: boolean;
  /** 마지막 DB 갱신 시도 결과 (서버 재시작 후에는 null) */
  lastRefresh: GeoipRefreshInfo | null;
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

export interface SessionsResult {
  rows: SessionRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SessionsParams {
  userId?: number;
  platform?: string;
  ip?: string;
  from?: number;
  to?: number;
  sort?: 'created_at' | 'last_seen_at';
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface Insights {
  ip: string;
  fetchedAt: number;
  lat: number | null;
  lon: number | null;
  /** 위치 정확도 반경 (km) */
  accuracyRadius: number | null;
  city: string | null;
  region: string | null;
  country: string | null;
  isp: string | null;
  organization: string | null;
  userType: string | null;
  data: string;
}

export interface InsightsResult {
  /** true면 저장된 결과 재사용 (1주 캐시) — API 호출 없음 */
  cached: boolean;
  /** 캐시가 1주를 넘겼지만 API 호출이 실패해 대신 내려준 경우 */
  stale: boolean;
  insights: Insights;
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

export interface NotificationLogRow {
  id: number;
  userId: number;
  username: string | null;
  nickname: string | null;
  channel: 'web' | 'expo';
  conversationId: number | null;
  bodyPreview: string;
  sentAt: number;
  sentStatus: 'ok' | 'error' | 'expired';
  sentError: string | null;
  receiptStatus: 'pending' | 'ok' | 'error' | null;
  receiptCheckedAt: number | null;
  receivedAt: number | null;
  receivedStatus: 'received' | 'pending' | 'presumed_lost' | 'n-a';
}

export interface NotificationsResult {
  rows: NotificationLogRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface NotificationsParams {
  userId?: number;
  channel?: string;
  sentStatus?: string;
  receivedStatus?: string;
  from?: number;
  to?: number;
  sort?: 'sent_at' | 'received_at';
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface NotificationSummary {
  totalSent: number;
  byStatus: { status: string; count: number }[];
  receivedCount: number;
  receivedRate: number;
  avgLatencySeconds: number | null;
}

export const adminApi = {
  login: (username: string, password: string) =>
    request<{ ok: true }>('/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request<{ ok: true }>('/logout', { method: 'POST' }),
  me: () => request<AdminMe>('/me'),
  config: () => request<AdminConfig>('/config'),
  overview: (days = 30) => request<Overview>(`/overview?days=${days}`),
  timeseries: (days = 30) => request<TimeseriesPoint[]>(`/timeseries?days=${days}`),
  geo: (days = 30) => request<GeoPoint[]>(`/geo?days=${days}`),
  geoStatus: (days = 30) => request<GeoStatus>(`/geo/status?days=${days}`),
  usersVisits: () => request<UserVisit[]>('/users/visits'),
  vitals: (metric = 'LCP', days = 30) => request<VitalsPoint[]>(`/vitals?metric=${metric}&days=${days}`),
  sessions: (params: SessionsParams = {}) => {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') qs.set(key, String(value));
    }
    return request<SessionsResult>(`/sessions?${qs.toString()}`);
  },
  notifications: (params: NotificationsParams = {}) => {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') qs.set(key, String(value));
    }
    return request<NotificationsResult>(`/notifications?${qs.toString()}`);
  },
  notificationsSummary: (days = 30) =>
    request<NotificationSummary>(`/notifications/summary?days=${days}`),
  insights: (ip: string) =>
    request<InsightsResult>(`/geoip/insights/${encodeURIComponent(ip)}`, { method: 'POST' }),
  insightsByUser: (userId: number) =>
    request<{ insights: Insights[] }>(`/geoip/insights/by-user/${userId}`),
  watchList: () => request<{ watched: number[] }>('/geoip/watch'),
  watchAdd: (userId: number) => request<{ ok: true }>(`/geoip/watch/${userId}`, { method: 'POST' }),
  watchRemove: (userId: number) =>
    request<{ ok: true }>(`/geoip/watch/${userId}`, { method: 'DELETE' }),
  geoipRefresh: () => request<GeoipRefreshInfo>('/geoip/refresh', { method: 'POST' }),
};
