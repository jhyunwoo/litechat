/**
 * 지도 페이지 공용 타입/헬퍼 — 컨테이너(MapPage)와 하위 컴포넌트가 함께 쓴다.
 */
import type { Insights, SessionRow } from '../../api';

/** 위도/경도 사각형 — google.maps.LatLngBoundsLiteral과 같은 모양 (타입 의존 없이 씀) */
export interface LatLngBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

/**
 * 지도 이동 목표 — 값이 바뀌면 MapController가 팬/줌하거나 bounds에 맞춘다.
 * 같은 목표를 다시 눌러도 이동하도록 호출부는 매번 새 객체를 만든다.
 */
export type MapTarget =
  { kind: 'point'; lat: number; lng: number; zoom?: number } | { kind: 'bounds'; box: LatLngBox };

/**
 * 위치가 있는 접속 기록들을 감싸는 최소 사각형 — '결과 전체 보기'용.
 * 위치가 있는 기록이 2건 미만이면 null (한 점에 fitBounds하면 최대 줌으로 튄다).
 */
export function boundsOf(rows: SessionRow[]): LatLngBox | null {
  const located = rows.filter((row) => row.lat !== null && row.lon !== null);
  if (located.length < 2) return null;
  const lats = located.map((row) => row.lat!);
  const lons = located.map((row) => row.lon!);
  return {
    north: Math.max(...lats),
    south: Math.min(...lats),
    east: Math.max(...lons),
    west: Math.min(...lons),
  };
}

/** 선택된 접속 기록의 정확도 반경 원 (km는 MaxMind 표준 단위) */
export interface SelectedCircle {
  lat: number;
  lng: number;
  radiusKm: number;
}

/** 접속 기록 조회 조건 — 패널 필터 UI와 컨테이너(MapPage)가 공유한다 */
export interface SessionFilters {
  /** 사용자 ID (select 바인딩용 문자열, '' = 전체) */
  userId: string;
  platform: string;
  /** IP 부분 일치 검색 */
  ip: string;
  /** yyyy-mm-dd, '' = 제한 없음 */
  fromDate: string;
  toDate: string;
  /** 조회할 접속 기록 수 (서버 pageSize 상한 200) */
  limit: number;
}

/** 조회 건수 선택지 — 서버가 pageSize를 200으로 제한하므로 그 안에서 고른다 */
export const LIMIT_OPTIONS = [50, 100, 200] as const;

/** GeoLite2 정확도가 없는 레거시 밀도 지점에 쓰는 보수적 기본 반경 (도시 수준) */
export const DEFAULT_ACCURACY_KM = 25;

/** 핀 팔레트 — 선택 = Action Blue(흰 테두리, 반경 원과 한 쌍), 비선택 = 중간 회색 */
export const PIN = {
  selectedBg: '#0066CC',
  normalBg: '#7A7A7A',
  border: '#ffffff',
  glyph: '#ffffff',
} as const;

/** 선택 강조 액센트 — 어두운 지도 + 흰 원들 사이에서 선택 기록(핀+원)을 즉시 구분 */
export const SELECTED_CIRCLE = {
  stroke: '#2997FF', // Sky Blue — 어두운 타일 위 시인성
  fill: '#0066CC', // Action Blue
} as const;

/** 사설(프록시 내부) IP 여부 — true면 프록시가 X-Forwarded-For를 안 넘긴 것으로 진단한다. */
export function isPrivateIp(ip: string): boolean {
  const v = ip.replace(/^::ffff:/i, ''); // IPv6-mapped IPv4 정규화
  if (/^10\./.test(v)) return true;
  if (/^192\.168\./.test(v)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(v)) return true;
  if (/^127\./.test(v) || v === '0.0.0.0') return true;
  if (/^(fc|fd)/i.test(v) || v === '::1') return true; // IPv6 ULA/loopback
  return false;
}

/** API/캐시 비교용 최소 정규화 — 서버와 같이 IPv4-mapped 접두사를 제거한다. */
export function normalizeDisplayIp(ip: string): string {
  return ip.replace(/^::ffff:/i, '').toLowerCase();
}

export function isInsightsForSession(row: SessionRow, details: Insights): boolean {
  return normalizeDisplayIp(row.ip) === normalizeDisplayIp(details.ip);
}

/** 조회 직후 저장된 Insights 위치를 같은 IP의 세션 행에 즉시 반영한다. */
export function applyInsightsLocation(row: SessionRow, details: Insights): SessionRow {
  if (!isInsightsForSession(row, details) || details.lat === null || details.lon === null)
    return row;
  return {
    ...row,
    country: details.country ?? row.country,
    region: details.region ?? row.region,
    city: details.city ?? row.city,
    lat: details.lat,
    lon: details.lon,
    accuracyKm: details.accuracyRadius ?? row.accuracyKm,
    locationSource: 'insights',
  };
}

export function formatDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** 밀리초 epoch → HH:MM:SS — "마지막 업데이트" 표시용 */
export function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString('ko-KR', { hour12: false });
}

/** yyyy-mm-dd(로컬) → epoch 초. endOfDay면 그날 23:59:59 */
export function dateToEpoch(value: string, endOfDay: boolean): number | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T${endOfDay ? '23:59:59' : '00:00:00'}`);
  return Math.floor(date.getTime() / 1000);
}
