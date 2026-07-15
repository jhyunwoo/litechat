/**
 * 지도 페이지 공용 타입/헬퍼 — 컨테이너(MapPage)와 하위 컴포넌트가 함께 쓴다.
 */

/** 지도 이동 목표 — 값이 바뀌면 MapController가 팬/줌한다 */
export interface MapTarget {
  lat: number;
  lng: number;
  zoom?: number;
}

/** 선택된 접속 기록의 정확도 반경 원 (km는 MaxMind 표준 단위) */
export interface SelectedCircle {
  lat: number;
  lng: number;
  radiusKm: number;
}

/** GeoLite2 정확도가 없는 레거시 밀도 지점에 쓰는 보수적 기본 반경 (도시 수준) */
export const DEFAULT_ACCURACY_KM = 25;

/** 모노크롬 핀 팔레트 — 선택 = 잉크 블랙(흰 테두리), 비선택 = 중간 회색 */
export const PIN = {
  selectedBg: '#1d1d1f',
  normalBg: '#6e6e73',
  border: '#ffffff',
  glyph: '#ffffff',
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

export function formatDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
