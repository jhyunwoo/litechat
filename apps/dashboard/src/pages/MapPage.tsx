/**
 * 지도 — 세션의 GeoIP 위치를 원형 마커로 표시한다 (Google Maps JavaScript API).
 *
 * - 접속 수에 비례해 커지는 원형 AdvancedMarker로 지점별 밀도를 나타낸다.
 * - 사용자를 선택하면 그 사용자의 접속 기록별 위치가 핀으로 표시되고, 기록을
 *   클릭하면 지도가 해당 위치로 이동한다.
 * - 선택한 기록의 IP는 GeoIP2 Insights로 상세 조회(ISP/조직/정확도 반경)할 수 있고,
 *   반경 데이터가 있으면 지도에 원으로 그려진다. 같은 IP는 1주간 캐시를 재사용한다
 *   (Insights는 쿼리당 과금되는 비싼 API).
 *
 * API 키는 빌드 시점이 아니라 서버 환경변수(GOOGLE_MAPS_API_KEY)에서 런타임에 받아온다
 * (키 교체 시 재빌드가 필요 없고, Dokploy가 서버 컨테이너에만 환경변수를 주입하기 때문).
 *
 * 지도가 비는 "조용한 실패"를 진단할 수 있도록, GeoIP DB 로드 상태와 위치 조회에
 * 실패한 IP 표본을 함께 보여준다(원인이 mmdb 누락인지 프록시 IP인지 한눈에 구분).
 */
import { type ReactNode, useEffect, useState } from 'react';
import { AdvancedMarker, APIProvider, Circle, Map, Pin, useMap } from '@vis.gl/react-google-maps';
import {
  adminApi,
  type AdminConfig,
  type GeoPoint,
  type GeoStatus,
  type InsightsResult,
  type SessionRow,
  type UserVisit,
} from '../api';

/** 접속 수에 비례해 마커 지름을 키운다 (14~52px) */
function diameterFor(count: number, max: number): number {
  if (max <= 0) return 14;
  return 14 + (count / max) * 38;
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

function formatDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

const DB_STATUS_LABEL: Record<GeoStatus['dbStatus'], string> = {
  ok: '정상 로드됨',
  missing: '파일 없음',
  error: '열기 실패',
  unopened: '미확인',
};

interface MapTarget {
  lat: number;
  lng: number;
  zoom?: number;
}

export default function MapPage() {
  const [points, setPoints] = useState<GeoPoint[]>([]);
  const [status, setStatus] = useState<GeoStatus | null>(null);
  const [config, setConfig] = useState<AdminConfig | null>(null);

  // 사용자 선택 → 접속 기록 → 기록 선택 → Insights
  const [users, setUsers] = useState<UserVisit[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserVisit | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selectedSession, setSelectedSession] = useState<SessionRow | null>(null);
  const [insights, setInsights] = useState<InsightsResult | null>(null);
  const [insightsBusy, setInsightsBusy] = useState(false);
  const [insightsError, setInsightsError] = useState('');
  const [target, setTarget] = useState<MapTarget | null>(null);

  useEffect(() => {
    void adminApi.geo(30).then(setPoints);
    void adminApi.geoStatus(30).then(setStatus);
    void adminApi.config().then(setConfig);
    void adminApi.usersVisits().then(setUsers);
  }, []);

  function selectUser(user: UserVisit) {
    setSelectedUser(user);
    setSelectedSession(null);
    setInsights(null);
    setInsightsError('');
    setSessions([]);
    void adminApi
      .sessions({ userId: user.userId, pageSize: 100, sort: 'created_at', dir: 'desc' })
      .then((result) => {
        setSessions(result.rows);
        // 위치가 있는 가장 최근 기록으로 지도를 이동한다.
        const located = result.rows.find((row) => row.lat !== null);
        if (located) setTarget({ lat: located.lat!, lng: located.lon!, zoom: 6 });
      });
  }

  function selectSession(row: SessionRow) {
    setSelectedSession(row);
    setInsights(null);
    setInsightsError('');
    if (row.lat !== null && row.lon !== null) {
      setTarget({ lat: row.lat, lng: row.lon, zoom: 10 });
    }
  }

  function lookupInsights(ip: string) {
    if (insightsBusy) return;
    setInsightsBusy(true);
    setInsightsError('');
    void adminApi
      .insights(ip)
      .then((result) => {
        setInsights(result);
        const { lat, lon } = result.insights;
        if (lat !== null && lon !== null) setTarget({ lat, lng: lon, zoom: 11 });
      })
      .catch((err: Error) => setInsightsError(err.message))
      .finally(() => setInsightsBusy(false));
  }

  const max = Math.max(0, ...points.map((p) => p.count));
  const circle = insights?.insights;
  const locatedSessions = sessions.filter((row) => row.lat !== null && row.lon !== null);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-hairline bg-card p-5">
        <h2 className="mb-4 text-sm text-ink-mute">
          접속 위치 (최근 30일, {points.length}개 지점
          {selectedUser ? ` · ${selectedUser.nickname} 기록 ${locatedSessions.length}건 핀 표시` : ''})
        </h2>
        {config && !config.googleMapsApiKey ? (
          <div className="flex h-[420px] items-center justify-center rounded-xl border border-hairline/50 px-6 text-center text-xs text-ink-mute">
            Google Maps API 키가 설정되지 않았습니다. 서버 환경변수 GOOGLE_MAPS_API_KEY를 지정하세요.
          </div>
        ) : config ? (
          <APIProvider apiKey={config.googleMapsApiKey}>
            <Map
              className="h-[420px] w-full overflow-hidden rounded-xl"
              defaultCenter={{ lat: 20, lng: 10 }}
              defaultZoom={2}
              mapId={config.googleMapsMapId}
              gestureHandling="greedy"
              disableDefaultUI={false}
            >
              <MapController target={target} />
              {points.map((p) => (
                <PointMarker key={`${p.lat},${p.lon}`} point={p} max={max} />
              ))}
              {/* 선택한 사용자의 접속 기록 핀 — 클릭하면 해당 기록이 선택된다 */}
              {locatedSessions.map((row) => (
                <AdvancedMarker
                  key={row.id}
                  position={{ lat: row.lat!, lng: row.lon! }}
                  title={`${formatDate(row.createdAt)} · ${row.ip}`}
                  onClick={() => selectSession(row)}
                >
                  <Pin
                    background={selectedSession?.id === row.id ? '#ea2261' : '#8b7bff'}
                    borderColor="#ffffff"
                    glyphColor="#ffffff"
                    scale={selectedSession?.id === row.id ? 1.1 : 0.8}
                  />
                </AdvancedMarker>
              ))}
              {/* Insights 정확도 반경 (km → m) */}
              {circle && circle.lat !== null && circle.lon !== null && circle.accuracyRadius !== null && (
                <Circle
                  center={{ lat: circle.lat, lng: circle.lon }}
                  radius={circle.accuracyRadius * 1000}
                  strokeColor="#8b7bff"
                  strokeOpacity={0.8}
                  strokeWeight={1.5}
                  fillColor="#8b7bff"
                  fillOpacity={0.15}
                />
              )}
            </Map>
          </APIProvider>
        ) : (
          <div className="flex h-[420px] items-center justify-center rounded-xl border border-hairline/50 text-xs text-ink-mute">
            지도 불러오는 중…
          </div>
        )}
      </div>

      {/* 사용자 선택 + 접속 기록 브라우저 */}
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <div className="rounded-xl border border-hairline bg-card p-4">
          <h2 className="mb-3 text-sm text-ink-mute">사용자 ({users.length})</h2>
          <div className="flex max-h-[360px] flex-col gap-1 overflow-y-auto">
            {users.map((user) => (
              <button
                key={user.userId}
                onClick={() => selectUser(user)}
                className={`rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  selectedUser?.userId === user.userId
                    ? 'bg-primary text-white'
                    : 'text-ink-mute hover:bg-shell/60 hover:text-white'
                }`}
              >
                {user.nickname}
                <span className="ml-1 text-xs opacity-70">@{user.username}</span>
                <span className="tnum float-right text-xs opacity-70">{user.sessionCount}</span>
              </button>
            ))}
            {users.length === 0 && <p className="py-4 text-center text-xs text-ink-mute">없음</p>}
          </div>
        </div>

        <div className="rounded-xl border border-hairline bg-card p-4">
          <h2 className="mb-3 text-sm text-ink-mute">
            {selectedUser
              ? `${selectedUser.nickname}의 접속 기록 (최근 ${sessions.length}건)`
              : '접속 기록 — 왼쪽에서 사용자를 선택하거나 지도의 핀을 클릭하세요'}
          </h2>

          {insightsError !== '' && (
            <p className="mb-3 rounded-md border border-danger/40 px-3 py-2 text-xs text-danger">
              Insights 조회 실패: {insightsError}
            </p>
          )}

          {insights && <InsightsCard result={insights} />}

          {selectedUser && (
            <div className="max-h-[320px] overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-card text-ink-mute">
                  <tr className="border-b border-hairline">
                    <th className="py-2 pr-4 font-normal">접속 시간</th>
                    <th className="py-2 pr-4 font-normal">플랫폼</th>
                    <th className="py-2 pr-4 font-normal">IP</th>
                    <th className="py-2 pr-4 font-normal">위치</th>
                    <th className="py-2 pr-4 font-normal" />
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => selectSession(row)}
                      className={`cursor-pointer border-b border-hairline/50 ${
                        selectedSession?.id === row.id ? 'bg-shell/70' : 'hover:bg-shell/40'
                      }`}
                    >
                      <td className="tnum whitespace-nowrap py-2 pr-4">
                        {formatDate(row.createdAt)}
                      </td>
                      <td className="py-2 pr-4">{row.platform}</td>
                      <td className="tnum whitespace-nowrap py-2 pr-4">{row.ip}</td>
                      <td className="whitespace-nowrap py-2 pr-4 text-ink-mute">
                        {[row.city, row.country].filter(Boolean).join(', ') || '—'}
                      </td>
                      <td className="py-2 pr-2 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            selectSession(row);
                            lookupInsights(row.ip);
                          }}
                          disabled={insightsBusy}
                          className="rounded-md border border-hairline px-2 py-1 text-ink-mute hover:text-white disabled:opacity-40"
                          title="GeoIP2 Insights 상세 조회 (유료 API — 같은 IP는 1주 캐시)"
                        >
                          상세 조회
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {sessions.length === 0 && (
                <p className="py-6 text-center text-xs text-ink-mute">접속 기록이 없어요.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {status && <GeoDiagnostics status={status} onRefreshed={setStatus} />}
    </div>
  );
}

/** 지도 이동 컨트롤러 — target이 바뀌면 해당 위치로 팬/줌한다 (Map 자식으로만 동작) */
function MapController({ target }: { target: MapTarget | null }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !target) return;
    map.panTo({ lat: target.lat, lng: target.lng });
    if (target.zoom) map.setZoom(target.zoom);
  }, [map, target]);
  return null;
}

/** 접속 수에 비례한 원형 마커 — 브라우저 기본 title로 툴팁을 표시한다. */
function PointMarker({ point, max }: { point: GeoPoint; max: number }) {
  const size = diameterFor(point.count, max);
  const label = `${[point.city, point.country].filter(Boolean).join(', ') || '알 수 없음'} · ${point.count}건`;
  return (
    <AdvancedMarker position={{ lat: point.lat, lng: point.lon }} title={label}>
      <div
        style={{ width: size, height: size }}
        className="rounded-full border border-primary-soft bg-primary-soft/50"
      />
    </AdvancedMarker>
  );
}

/** Insights 상세 카드 — ISP/조직/반경/캐시 여부 */
function InsightsCard({ result }: { result: InsightsResult }) {
  const i = result.insights;
  return (
    <div className="mb-3 rounded-md border border-hairline/70 bg-shell/40 px-4 py-3 text-xs">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm">Insights · {i.ip}</span>
        {result.cached && (
          <span className="rounded-full border border-hairline px-2 py-0.5 text-ink-mute">
            캐시됨 · {formatDate(i.fetchedAt)}
          </span>
        )}
        {result.stale && (
          <span className="rounded-full border border-danger/40 px-2 py-0.5 text-danger">
            오래된 캐시 (API 실패)
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
        <span>
          <span className="text-ink-mute">위치 </span>
          {[i.city, i.region, i.country].filter(Boolean).join(', ') || '—'}
        </span>
        <span>
          <span className="text-ink-mute">정확도 반경 </span>
          <span className="tnum">{i.accuracyRadius !== null ? `${i.accuracyRadius}km` : '—'}</span>
        </span>
        <span>
          <span className="text-ink-mute">사용자 유형 </span>
          {i.userType ?? '—'}
        </span>
        <span>
          <span className="text-ink-mute">ISP </span>
          {i.isp ?? '—'}
        </span>
        <span className="col-span-2">
          <span className="text-ink-mute">조직 </span>
          {i.organization ?? '—'}
        </span>
      </div>
    </div>
  );
}

/** 위치 조회 진단 패널 — DB 상태, 자동 갱신, 확보율, 실패 IP 표본으로 원인을 안내한다. */
function GeoDiagnostics({
  status,
  onRefreshed,
}: {
  status: GeoStatus;
  onRefreshed: (status: GeoStatus) => void;
}) {
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const ok = status.dbStatus === 'ok';
  const privateIps = status.ungeolocated.filter((r) => isPrivateIp(r.ip)).length;
  const publicIps = status.ungeolocated.length - privateIps;

  function refreshDb() {
    if (refreshBusy) return;
    setRefreshBusy(true);
    setRefreshError('');
    void adminApi
      .geoipRefresh()
      .then((info) => {
        if (!info.ok) setRefreshError(info.error ?? 'UNKNOWN');
        return adminApi.geoStatus(30).then(onRefreshed);
      })
      .catch((err: Error) => setRefreshError(err.message))
      .finally(() => setRefreshBusy(false));
  }

  // 원인 추정: DB가 안 열렸으면 mmdb 문제, 열렸는데 실패 IP가 대부분 사설이면 프록시 문제.
  let hint: string | null = null;
  if (!ok) {
    hint =
      status.dbStatus === 'missing'
        ? `GeoIP DB 파일이 없습니다. MaxMind 자격 증명(MAXMIND_USER_NUM/MAXMIND_API_KEY)을 설정하면 자동으로 내려받거나, GeoLite2-City.mmdb를 ${status.dbPath} 에 직접 배치하세요.`
        : `GeoIP DB를 열지 못했습니다(${status.dbPath}). 파일 손상/권한 또는 Country 에디션(위·경도 없음) 여부를 확인하세요.`;
  } else if (status.withGeo === 0 && privateIps > 0 && publicIps === 0) {
    hint =
      '실패 IP가 모두 사설(프록시 내부) 주소입니다. Traefik이 X-Forwarded-For를 앱으로 전달하도록 프록시 설정을 확인하세요.';
  }

  return (
    <div className="rounded-xl border border-hairline bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm text-ink-mute">위치 조회 진단</h2>
        <button
          onClick={refreshDb}
          disabled={refreshBusy || !status.autoRefresh}
          className="rounded-md border border-hairline px-3 py-1.5 text-xs text-ink-mute hover:text-white disabled:opacity-40"
          title={
            status.autoRefresh
              ? 'MaxMind에서 최신 GeoLite2 DB를 즉시 내려받아 교체합니다'
              : 'MAXMIND_USER_NUM/MAXMIND_API_KEY가 설정돼야 사용할 수 있어요'
          }
        >
          {refreshBusy ? '갱신 중…' : 'DB 새로고침'}
        </button>
      </div>

      {refreshError !== '' && (
        <p className="mb-4 rounded-md border border-danger/40 px-3 py-2 text-xs text-danger">
          DB 갱신 실패: {refreshError}
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Stat label="GeoIP DB">
          <span className={ok ? 'text-white' : 'text-danger'}>
            {DB_STATUS_LABEL[status.dbStatus]}
          </span>
        </Stat>
        <Stat label="주간 자동 갱신">
          {status.autoRefresh ? (
            <span className="text-white">
              켜짐
              {status.lastRefresh && (
                <span className="tnum block text-xs text-ink-mute">
                  최근: {formatDate(status.lastRefresh.at)}{' '}
                  {status.lastRefresh.ok ? '성공' : `실패(${status.lastRefresh.error})`}
                </span>
              )}
            </span>
          ) : (
            <span className="text-ink-mute">꺼짐 (자격 증명 없음)</span>
          )}
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
