/**
 * GeoLite2-City.mmdb 자동 갱신 — MaxMind 다운로드 API에서 최신 DB를 받아 교체한다.
 *
 * - 주 1회 갱신이 목표: 부팅 시 + 6시간마다 mmdb 파일 mtime을 확인해 7일이
 *   지났을 때만 실제로 내려받는다 (재시작해도 불필요한 재다운로드 없음).
 * - 교체는 같은 디렉터리 안에서 rename(원자적) 후 reloadGeoip()로 리더 캐시를
 *   비워, 프로세스 재시작 없이 다음 조회부터 새 DB가 적용된다.
 * - MAXMIND_USER_NUM/MAXMIND_API_KEY가 비어 있으면 조용히 비활성화된다
 *   (로컬 mmdb 조회 자체는 계속 동작).
 */
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AppConfig } from '../../config';
import { reloadGeoip } from './geoip';

const DOWNLOAD_URL =
  'https://download.maxmind.com/geoip/databases/GeoLite2-City/download?suffix=tar.gz';
/** mmdb가 이보다 오래되면 갱신한다 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** mtime 확인 주기 */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** 손상/빈 파일 방어 — 정상 GeoLite2-City.mmdb는 수십 MB다 */
const MIN_DB_BYTES = 1024 * 1024;

export interface GeoipRefreshInfo {
  at: number;
  ok: boolean;
  error?: string;
}

let lastRefresh: GeoipRefreshInfo | null = null;
let inFlight = false;

/** 마지막 갱신 시도 결과 — 대시보드 진단(/geo/status)에 노출한다 */
export function geoipRefreshInfo(): GeoipRefreshInfo | null {
  return lastRefresh;
}

/** MaxMind 자격 증명이 설정돼 있는지 */
export function geoipRefreshEnabled(config: AppConfig): boolean {
  return config.maxmindAccountId !== '' && config.maxmindLicenseKey !== '';
}

/** DB를 내려받아 교체한다. 실패해도 기존 DB는 그대로 유지된다. */
export async function refreshGeoipDb(config: AppConfig): Promise<GeoipRefreshInfo> {
  if (inFlight) return { at: Math.floor(Date.now() / 1000), ok: false, error: 'IN_PROGRESS' };
  inFlight = true;
  try {
    const info = await download(config);
    lastRefresh = info;
    return info;
  } finally {
    inFlight = false;
  }
}

async function download(config: AppConfig): Promise<GeoipRefreshInfo> {
  const at = Math.floor(Date.now() / 1000);
  if (!geoipRefreshEnabled(config)) return { at, ok: false, error: 'MAXMIND_NOT_CONFIGURED' };

  const dataDir = dirname(config.geoipDbPath);
  const tarPath = join(dataDir, 'geolite2-download.tar.gz');
  const extractDir = join(dataDir, 'geolite2-extract');
  try {
    mkdirSync(dataDir, { recursive: true });

    const auth = btoa(`${config.maxmindAccountId}:${config.maxmindLicenseKey}`);
    // 타임아웃 필수: 응답이 멎으면 inFlight가 영영 풀리지 않아 이후 갱신이 전부 막힌다.
    const res = await fetch(DOWNLOAD_URL, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return { at, ok: false, error: `DOWNLOAD_FAILED_${res.status}` };
    // Bun.write(path, Response) 스트리밍이 이 응답에서 완료되지 않는 문제가 있어
    // (Bun 1.3.x) 본문을 메모리로 받은 뒤 쓴다 — DB는 ~35MB라 부담 없다.
    await Bun.write(tarPath, await res.arrayBuffer());

    // tar.gz 해제 — 런타임 이미지(oven/bun, Debian)에 tar가 기본 포함돼 있다.
    rmSync(extractDir, { recursive: true, force: true });
    mkdirSync(extractDir);
    const proc = Bun.spawn(['tar', 'xzf', tarPath, '-C', extractDir], { stderr: 'pipe' });
    if ((await proc.exited) !== 0) {
      const stderr = await new Response(proc.stderr).text();
      return { at, ok: false, error: `EXTRACT_FAILED: ${stderr.slice(0, 200)}` };
    }

    // 타르 안 구조: GeoLite2-City_YYYYMMDD/GeoLite2-City.mmdb
    const subdir = readdirSync(extractDir).find((name) => name.startsWith('GeoLite2-City'));
    const mmdbPath = subdir ? join(extractDir, subdir, 'GeoLite2-City.mmdb') : null;
    if (!mmdbPath || !exists(mmdbPath)) return { at, ok: false, error: 'MMDB_NOT_IN_ARCHIVE' };
    if (statSync(mmdbPath).size < MIN_DB_BYTES) return { at, ok: false, error: 'MMDB_TOO_SMALL' };

    // 같은 디렉터리 내 rename은 원자적 — 조회 중에도 반쯤 쓰인 파일이 보이지 않는다.
    renameSync(mmdbPath, config.geoipDbPath);
    reloadGeoip();
    console.log(`GeoIP: ${config.geoipDbPath} 갱신 완료 — 다음 조회부터 새 DB 적용`);
    return { at, ok: true };
  } catch (err) {
    return { at, ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    rmSync(tarPath, { force: true });
    rmSync(extractDir, { recursive: true, force: true });
  }
}

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * 부팅 시 호출 — mmdb가 없거나 7일이 지났으면 갱신하고, 이후 6시간마다 재확인한다.
 * (별도 크론 인프라가 없는 단일 프로세스 서버라 인터벌 방식을 쓴다)
 */
export function startGeoipAutoRefresh(config: AppConfig): void {
  if (!geoipRefreshEnabled(config)) {
    console.log('GeoIP: MAXMIND_USER_NUM/MAXMIND_API_KEY 미설정 — 자동 갱신 비활성화');
    return;
  }
  const check = () => {
    let stale = true;
    try {
      stale = Date.now() - statSync(config.geoipDbPath).mtimeMs > MAX_AGE_MS;
    } catch {
      /* 파일 없음 → 즉시 내려받는다 */
    }
    if (stale) {
      void refreshGeoipDb(config).then((info) => {
        if (!info.ok) console.error(`GeoIP: 자동 갱신 실패 — ${info.error}`);
      });
    }
  };
  check();
  setInterval(check, CHECK_INTERVAL_MS);
}
