/**
 * GeoIP2 Insights API 클라이언트 — 선택한 IP에 대해서만 온디맨드 호출한다.
 *
 * Insights는 쿼리당 과금되는 비싼 API라서:
 *  - 관리자가 대시보드에서 명시적으로 요청한 IP만 조회하고
 *  - 결과를 geoip_insights 테이블에 저장해 1주 안의 재조회는 캐시로 응답한다
 *    (캐시 판정은 admin 라우트에서 fetched_at으로 수행).
 */
import type { AppConfig } from '../../config';

const INSIGHTS_URL = 'https://geoip.maxmind.com/geoip/v2.1/insights/';

/** geoip_insights 테이블 한 행 — 대시보드에 그대로 내려준다 */
export interface InsightsRow {
  ip: string;
  fetchedAt: number;
  lat: number | null;
  lon: number | null;
  /** 위치 정확도 반경 (km) — 지도에 원으로 표시한다 */
  accuracyRadius: number | null;
  city: string | null;
  region: string | null;
  country: string | null;
  isp: string | null;
  organization: string | null;
  userType: string | null;
  /** 원본 응답 JSON 전문 */
  data: string;
}

/** Insights 응답에서 대시보드가 쓰는 필드만 추린 부분 타입 */
interface InsightsResponse {
  location?: { latitude?: number; longitude?: number; accuracy_radius?: number };
  city?: { names?: { en?: string } };
  subdivisions?: { iso_code?: string }[];
  country?: { iso_code?: string };
  traits?: { isp?: string; organization?: string; user_type?: string };
}

export type InsightsResult =
  | { ok: true; row: InsightsRow }
  | { ok: false; error: string; status?: number };

/** IPv6-mapped IPv4(::ffff:1.2.3.4)를 정규화한다 — API와 캐시 키 양쪽에 사용 */
export function normalizeIp(ip: string): string {
  return ip.replace(/^::ffff:/i, '');
}

export async function fetchInsights(config: AppConfig, ip: string): Promise<InsightsResult> {
  if (!config.maxmindAccountId || !config.maxmindLicenseKey) {
    return { ok: false, error: 'MAXMIND_NOT_CONFIGURED' };
  }

  const auth = btoa(`${config.maxmindAccountId}:${config.maxmindLicenseKey}`);
  let res: Response;
  try {
    res = await fetch(INSIGHTS_URL + encodeURIComponent(ip), {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'NETWORK_ERROR' };
  }

  if (!res.ok) {
    // 401/402(자격 증명·크레딧)과 404(예약/미등록 IP)를 구분해 안내한다.
    const body = (await res.json().catch(() => ({}))) as { code?: string };
    return { ok: false, error: body.code ?? `HTTP_${res.status}`, status: res.status };
  }

  const data = (await res.json()) as InsightsResponse;
  return {
    ok: true,
    row: {
      ip,
      fetchedAt: Math.floor(Date.now() / 1000),
      lat: data.location?.latitude ?? null,
      lon: data.location?.longitude ?? null,
      accuracyRadius: data.location?.accuracy_radius ?? null,
      city: data.city?.names?.en ?? null,
      region: data.subdivisions?.[0]?.iso_code ?? null,
      country: data.country?.iso_code ?? null,
      isp: data.traits?.isp ?? null,
      organization: data.traits?.organization ?? null,
      userType: data.traits?.user_type ?? null,
      data: JSON.stringify(data),
    },
  };
}
