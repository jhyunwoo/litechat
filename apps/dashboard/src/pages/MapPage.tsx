/**
 * 지도 — 세션의 GeoIP 위치를 원형 마커로 표시한다 (OpenStreetMap 타일, API 키 불필요).
 * 기본 Marker 아이콘 대신 CircleMarker를 써서 아이콘 에셋 경로 문제를 피한다.
 *
 * 지도가 비는 "조용한 실패"를 진단할 수 있도록, GeoIP DB 로드 상태와 위치 조회에
 * 실패한 IP 표본을 함께 보여준다(원인이 mmdb 누락인지 프록시 IP인지 한눈에 구분).
 */
import { type ReactNode, useEffect, useState } from 'react';
import { CircleMarker, MapContainer, TileLayer, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { adminApi, type GeoPoint, type GeoStatus } from '../api';

/** 접속 수에 비례해 마커 반지름을 키운다 (5~22px) */
function radiusFor(count: number, max: number): number {
  if (max <= 0) return 5;
  return 5 + (count / max) * 17;
}

/** 사설(프록시 내부) IP 여부 — true면 프록시가 X-Forwarded-For를 안 넘긴 것으로 진단한다. */
function isPrivateIp(ip: string): boolean {
  const v = ip.replace(/^::ffff:/i, ''); // IPv6-mapped IPv4 정규화
  if (/^10\./.test(v)) return true;
  if (/^192\.168\./.test(v)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(v)) return true;
  if (/^127\./.test(v) || v === '0.0.0.0') return true;
  if (/^(fc|fd)/i.test(v) || v === '::1') return true; // IPv6 ULA/loopback
  return false;
}

const DB_STATUS_LABEL: Record<GeoStatus['dbStatus'], string> = {
  ok: '정상 로드됨',
  missing: '파일 없음',
  error: '열기 실패',
  unopened: '미확인',
};

export default function MapPage() {
  const [points, setPoints] = useState<GeoPoint[]>([]);
  const [status, setStatus] = useState<GeoStatus | null>(null);

  useEffect(() => {
    void adminApi.geo(30).then(setPoints);
    void adminApi.geoStatus(30).then(setStatus);
  }, []);

  const max = Math.max(0, ...points.map((p) => p.count));

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-hairline bg-card p-5">
        <h2 className="mb-4 text-sm text-ink-mute">
          접속 위치 (최근 30일, {points.length}개 지점)
        </h2>
        <MapContainer center={[20, 10]} zoom={2} scrollWheelZoom={true}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {points.map((p) => (
            <CircleMarker
              key={`${p.lat},${p.lon}`}
              center={[p.lat, p.lon]}
              radius={radiusFor(p.count, max)}
              pathOptions={{ color: '#8b7bff', fillColor: '#8b7bff', fillOpacity: 0.5 }}
            >
              <Tooltip>
                {[p.city, p.country].filter(Boolean).join(', ') || '알 수 없음'} · {p.count}건
              </Tooltip>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>

      {status && <GeoDiagnostics status={status} />}
    </div>
  );
}

/** 위치 조회 진단 패널 — DB 상태, 확보율, 실패 IP 표본으로 원인을 안내한다. */
function GeoDiagnostics({ status }: { status: GeoStatus }) {
  const ok = status.dbStatus === 'ok';
  const privateIps = status.ungeolocated.filter((r) => isPrivateIp(r.ip)).length;
  const publicIps = status.ungeolocated.length - privateIps;

  // 원인 추정: DB가 안 열렸으면 mmdb 문제, 열렸는데 실패 IP가 대부분 사설이면 프록시 문제.
  let hint: string | null = null;
  if (!ok) {
    hint =
      status.dbStatus === 'missing'
        ? `GeoIP DB 파일이 없습니다. MaxMind GeoLite2-City.mmdb를 ${status.dbPath} 에 배치한 뒤 앱을 재시작하세요.`
        : `GeoIP DB를 열지 못했습니다(${status.dbPath}). 파일 손상/권한 또는 Country 에디션(위·경도 없음) 여부를 확인하세요.`;
  } else if (status.withGeo === 0 && privateIps > 0 && publicIps === 0) {
    hint =
      '실패 IP가 모두 사설(프록시 내부) 주소입니다. Traefik이 X-Forwarded-For를 앱으로 전달하도록 프록시 설정을 확인하세요.';
  }

  return (
    <div className="rounded-xl border border-hairline bg-card p-5">
      <h2 className="mb-4 text-sm text-ink-mute">위치 조회 진단</h2>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="GeoIP DB">
          <span className={ok ? 'text-white' : 'text-danger'}>
            {DB_STATUS_LABEL[status.dbStatus]}
          </span>
        </Stat>
        <Stat label="위치 확보 세션">
          <span className="tnum">
            {status.withGeo} / {status.total}
          </span>
        </Stat>
        <Stat label="실패 IP · 사설">
          <span className="tnum">{privateIps}</span>
        </Stat>
        <Stat label="실패 IP · 공인">
          <span className="tnum">{publicIps}</span>
        </Stat>
      </div>

      {hint && (
        <p className="mt-4 rounded-md border border-hairline/50 px-3 py-2 text-xs text-ink-mute">
          {hint}
        </p>
      )}

      {status.ungeolocated.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-ink-mute">
              <tr>
                <th className="py-2 pr-4">실패 IP (위치 조회 안 됨)</th>
                <th className="py-2 pr-4">구분</th>
                <th className="py-2 pr-4">세션 수</th>
              </tr>
            </thead>
            <tbody>
              {status.ungeolocated.map((r) => (
                <tr key={r.ip} className="border-b border-hairline/50">
                  <td className="py-2 pr-4 font-normal">{r.ip}</td>
                  <td className="py-2 pr-4">
                    {isPrivateIp(r.ip) ? (
                      <span className="text-danger">사설(프록시)</span>
                    ) : (
                      <span className="text-ink-mute">공인(mmdb 확인)</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 tnum">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-hairline/50 px-4 py-2.5">
      <div className="text-xs text-ink-mute">{label}</div>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}
