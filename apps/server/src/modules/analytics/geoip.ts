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
  /** 위치 정확도 반경 (km, MaxMind 표준 단위) — 지도의 미터 기반 원에 쓴다 */
  accuracyKm: number | null;
}

/**
 * GeoIP DB 로드 상태 — 대시보드 진단에 노출한다.
 * 'unopened' 아직 열기 시도 안 함 / 'ok' 로드 성공 / 'missing' 파일 없음(ENOENT) / 'error' 그 외 실패
 */
export type GeoipStatus = 'unopened' | 'ok' | 'missing' | 'error';

// undefined = 아직 열기 시도 안 함, null = 열기 실패(영구 스킵), Reader = 성공
let reader: Reader<CityResponse> | null | undefined;
let status: GeoipStatus = 'unopened';

/** 현재 GeoIP DB 로드 상태 (열기를 시도하지 않는다). */
export function geoipStatus(): GeoipStatus {
  return status;
}

/**
 * 리더 캐시를 비워 다음 조회 때 mmdb를 다시 열게 한다 — DB 파일을 갱신(교체)한
 * 직후 호출한다. (reader는 영구 캐시라 이 호출 없이는 재시작 전까지 옛 DB를 쓴다)
 */
export function reloadGeoip(): void {
  reader = undefined;
  status = 'unopened';
}

/**
 * DB를 (아직 안 했다면) 열어보고 상태를 반환한다 — 대시보드 진단용.
 * 열기 결과는 lookupGeo와 같은 reader 캐시를 공유하므로, 실제 조회 동작과
 * 항상 일치하는 상태를 보고한다(실패는 재시작 전까지 영구 스킵된다).
 */
export async function probeGeoip(dbPath: string): Promise<GeoipStatus> {
  await getReader(dbPath);
  return status;
}

async function getReader(dbPath: string): Promise<Reader<CityResponse> | null> {
  if (reader !== undefined) return reader;
  try {
    // 캐시는 maxmind 내장 LRU를 사용 — 별도 캐시 레이어를 두지 않는다.
    reader = await maxmind.open<CityResponse>(dbPath, { cache: { max: 20_000 } });
    status = 'ok';
    console.log(`GeoIP: ${dbPath} 로드 완료 — 위치 조회 활성화`);
  } catch (err) {
    // 파일 없음(ENOENT)은 "mmdb를 배치하라"는 운영자 액션이 필요한 흔한 경우라 구분해 안내한다.
    const missing = (err as NodeJS.ErrnoException)?.code === 'ENOENT';
    status = missing ? 'missing' : 'error';
    console.error(
      missing
        ? `GeoIP: ${dbPath} 파일이 없어 위치 조회를 건너뜁니다. MaxMind GeoLite2-City.mmdb를 이 경로에 배치한 뒤 앱을 재시작하세요.`
        : `GeoIP: ${dbPath} 를 열 수 없어 이후 위치 조회를 건너뜁니다:`,
      missing ? '' : err,
    );
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
    accuracyKm: result.location?.accuracy_radius ?? null,
  };
}
