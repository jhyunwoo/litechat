/**
 * 위치 조회 진단 — DB 상태, 자동 갱신, 확보율, 실패 IP 표본으로 원인을 안내한다.
 * 글래스 패널의 "진단" 탭 내용물 (좁은 폭에 맞춰 2칸 스탯 그리드로 세로 배치).
 */
import { useState, type ReactNode } from 'react';
import { adminApi, type GeoStatus } from '../../api';
import { formatDate, isPrivateIp } from './shared';

const DB_STATUS_LABEL: Record<GeoStatus['dbStatus'], string> = {
  ok: '정상 로드됨',
  missing: '파일 없음',
  error: '열기 실패',
  unopened: '미확인',
};

export function GeoDiagnostics({
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
    <div>
      <div className="mb-3 flex items-center justify-between">
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
        <p className="mb-3 rounded-md border border-danger/40 px-3 py-2 text-xs text-danger">
          DB 갱신 실패: {refreshError}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
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
        <Stat label="실패 IP (사설/공인)">
          <span className="tnum">
            {privateIps} / {publicIps}
          </span>
        </Stat>
      </div>

      {hint && (
        <p className="mt-3 rounded-md border border-hairline/50 px-3 py-2 text-xs text-ink-mute">
          {hint}
        </p>
      )}

      {status.ungeolocated.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-ink-mute">
              <tr>
                <th className="py-2 pr-4">실패 IP</th>
                <th className="py-2 pr-4">구분</th>
                <th className="py-2 pr-4">세션 수</th>
              </tr>
            </thead>
            <tbody>
              {status.ungeolocated.map((r) => (
                <tr key={r.ip} className="border-b border-hairline/50">
                  <td className="tnum py-2 pr-4">{r.ip}</td>
                  <td className="py-2 pr-4">
                    {isPrivateIp(r.ip) ? (
                      <span className="text-danger">사설(프록시)</span>
                    ) : (
                      <span className="text-ink-mute">공인(mmdb 확인)</span>
                    )}
                  </td>
                  <td className="tnum py-2 pr-4">{r.count}</td>
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
    <div className="rounded-md border border-hairline/50 px-3 py-2">
      <div className="text-xs text-ink-mute">{label}</div>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}
