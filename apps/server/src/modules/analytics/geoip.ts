/**
 * GeoIP 조회 — 로컬 MaxMind GeoLite2-City.mmdb 파일 기반 (외부 API 호출 없음)
 *
 * mmdb 파일은 라이선스 바이너리라 git에 커밋하지 않고, 배포 시 데이터 볼륨에
 * 수동으로 배치한다 (docker-compose.yml 참고). 파일이 없으면 조회를 조용히
 * 건너뛰고 원본 IP만 저장한다 (우아한 저하).
 */
import maxmind, { type CityResponse, type Reader } from 'maxmind';

export interface GeoResult {
  country: string | null;
  region: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
}

// undefined = 아직 열기 시도 안 함, null = 열기 실패(영구 스킵), Reader = 성공
let reader: Reader<CityResponse> | null | undefined;

async function getReader(dbPath: string): Promise<Reader<CityResponse> | null> {
  if (reader !== undefined) return reader;
  try {
    // 캐시는 maxmind 내장 LRU를 사용 — 별도 캐시 레이어를 두지 않는다.
    reader = await maxmind.open<CityResponse>(dbPath, { cache: { max: 20_000 } });
  } catch {
    console.error(`GeoIP: ${dbPath} 를 열 수 없어 이후 위치 조회를 건너뜁니다.`);
    reader = null;
  }
  return reader;
}

/** IP로 위치를 조회한다. mmdb가 없거나 조회 실패 시 null. */
export async function lookupGeo(dbPath: string, ip: string): Promise<GeoResult | null> {
  const r = await getReader(dbPath);
  if (!r) return null;

  const result = r.get(ip);
  if (!result) return null;

  return {
    country: result.country?.iso_code ?? null,
    region: result.subdivisions?.[0]?.iso_code ?? null,
    city: result.city?.names?.en ?? null,
    lat: result.location?.latitude ?? null,
    lon: result.location?.longitude ?? null,
  };
}
