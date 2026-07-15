/**
 * 지도 — 뷰포트 전체 지도 + 왼쪽 글래스모피즘 접속 기록 패널.
 *
 * 지도 중심의 레이아웃: 지도가 화면을 가득 채우고, 접속 기록/사용자/진단은
 * 반투명 blur 패널로 지도 위에 떠서 지도가 비쳐 보인다 (PLAN.md).
 *  - 패널의 기록을 클릭하면 지도가 그 위치로 이동하고 해당 핀이 잉크 블랙으로 강조된다.
 *  - 지점 밀도/반경 원은 미터 기반이라 줌과 무관하게 정확한 지리 반경을 나타낸다.
 *  - 선택한 기록의 IP는 GeoIP2 Insights로 상세 조회(ISP/조직/정확도 반경)할 수 있고,
 *    같은 IP는 1주간 캐시를 재사용한다 (Insights는 쿼리당 과금되는 비싼 API).
 *
 * 상태와 데이터 로딩은 전부 이 컨테이너가 소유하고, 하위(MapCanvas/AccessPanel)는
 * props로만 동작하는 표현 컴포넌트다.
 */
import { useEffect, useState } from 'react';
import {
  adminApi,
  type AdminConfig,
  type GeoPoint,
  type GeoStatus,
  type Insights,
  type InsightsResult,
  type SessionRow,
  type UserVisit,
} from '../api';
import { AccessPanel, type PanelTab } from './map/AccessPanel';
import { MapCanvas } from './map/MapCanvas';
import type { MapTarget, SelectedCircle } from './map/shared';

export default function MapPage() {
  const [points, setPoints] = useState<GeoPoint[]>([]);
  const [status, setStatus] = useState<GeoStatus | null>(null);
  const [config, setConfig] = useState<AdminConfig | null>(null);

  // 패널 UI 상태
  const [panelOpen, setPanelOpen] = useState(true);
  const [tab, setTab] = useState<PanelTab>('sessions');

  // 접속 기록(기본 전체 최근순, 사용자 선택 시 필터) → 기록 선택 → Insights
  const [users, setUsers] = useState<UserVisit[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserVisit | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selectedSession, setSelectedSession] = useState<SessionRow | null>(null);
  const [insights, setInsights] = useState<InsightsResult | null>(null);
  const [insightsBusy, setInsightsBusy] = useState(false);
  const [insightsError, setInsightsError] = useState('');
  const [target, setTarget] = useState<MapTarget | null>(null);

  // Insights 상시 수집 대상 + 선택한 사용자의 수집된 Insights
  const [watched, setWatched] = useState<Set<number>>(new Set());
  const [watchBusy, setWatchBusy] = useState(false);
  const [userInsights, setUserInsights] = useState<Insights[]>([]);

  useEffect(() => {
    void adminApi.geo(30).then(setPoints);
    void adminApi.geoStatus(30).then(setStatus);
    void adminApi.config().then(setConfig);
    void adminApi.usersVisits().then(setUsers);
    void adminApi.watchList().then((r) => setWatched(new Set(r.watched)));
    loadSessions(); // 기본: 전체 최근 접속 기록
  }, []);

  /** 접속 기록 로드 — userId를 주면 그 사용자로 필터, 없으면 전체 최근순 */
  function loadSessions(userId?: number) {
    void adminApi
      .sessions({ userId, pageSize: 100, sort: 'created_at', dir: 'desc' })
      .then((result) => {
        setSessions(result.rows);
        if (userId !== undefined) {
          // 위치가 있는 가장 최근 기록으로 지도를 이동한다.
          const located = result.rows.find((row) => row.lat !== null);
          if (located) setTarget({ lat: located.lat!, lng: located.lon!, zoom: 6 });
        }
      });
  }

  function loadUserInsights(userId: number) {
    void adminApi.insightsByUser(userId).then((r) => setUserInsights(r.insights));
  }

  function selectUser(user: UserVisit) {
    setSelectedUser(user);
    setSelectedSession(null);
    setInsights(null);
    setInsightsError('');
    setSessions([]);
    setUserInsights([]);
    setTab('sessions'); // 선택 결과(필터된 기록)가 바로 보이도록 기록 탭으로 전환
    loadUserInsights(user.userId);
    loadSessions(user.userId);
  }

  /** 사용자 필터 해제 — 전체 최근 기록으로 되돌린다 */
  function clearUser() {
    setSelectedUser(null);
    setSelectedSession(null);
    setInsights(null);
    setInsightsError('');
    setUserInsights([]);
    loadSessions();
  }

  /** 상시 수집 토글 — 켜면 서버가 최근 IP를 백필하므로 잠시 후 결과를 다시 불러온다 */
  function toggleWatch(user: UserVisit) {
    if (watchBusy) return;
    setWatchBusy(true);
    const isOn = watched.has(user.userId);
    void (isOn ? adminApi.watchRemove(user.userId) : adminApi.watchAdd(user.userId))
      .then(() => {
        setWatched((prev) => {
          const next = new Set(prev);
          if (isOn) next.delete(user.userId);
          else next.add(user.userId);
          return next;
        });
        if (!isOn) setTimeout(() => loadUserInsights(user.userId), 4000);
      })
      .catch((err: Error) => setInsightsError(err.message))
      .finally(() => setWatchBusy(false));
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

  /** 수집된 Insights 칩 클릭 — 상세 카드 표시 + 지도 이동 */
  function selectInsights(row: Insights) {
    setInsights({ cached: true, stale: false, insights: row });
    setTab('sessions'); // 상세 카드는 기록 탭에 표시된다
    if (row.lat !== null && row.lon !== null) {
      setTarget({ lat: row.lat, lng: row.lon, zoom: 11 });
    }
  }

  const locatedSessions = sessions.filter((row) => row.lat !== null && row.lon !== null);

  // 선택한 기록의 정확도 원 — Insights(유료, 더 정확) 우선, 없으면 세션의 GeoLite2 반경
  const selectedCircle: SelectedCircle | null = (() => {
    const i = insights?.insights;
    if (i && i.lat !== null && i.lon !== null && i.accuracyRadius !== null) {
      return { lat: i.lat, lng: i.lon, radiusKm: i.accuracyRadius };
    }
    const s = selectedSession;
    if (s && s.lat !== null && s.lon !== null && s.accuracyKm !== null) {
      return { lat: s.lat, lng: s.lon, radiusKm: s.accuracyKm };
    }
    return null;
  })();

  return (
    <div className="relative h-full w-full">
      <MapCanvas
        config={config}
        target={target}
        points={points}
        locatedSessions={locatedSessions}
        selectedSessionId={selectedSession?.id ?? null}
        selectedCircle={selectedCircle}
        onSelectSession={selectSession}
      />
      {panelOpen ? (
        <AccessPanel
          tab={tab}
          onTab={setTab}
          onClose={() => setPanelOpen(false)}
          sessions={sessions}
          selectedSession={selectedSession}
          selectedUser={selectedUser}
          insights={insights}
          insightsBusy={insightsBusy}
          insightsError={insightsError}
          onSelectSession={selectSession}
          onLookupInsights={lookupInsights}
          onClearUser={clearUser}
          users={users}
          watched={watched}
          watchBusy={watchBusy}
          userInsights={userInsights}
          onSelectUser={selectUser}
          onToggleWatch={toggleWatch}
          onSelectInsights={selectInsights}
          status={status}
          onStatusRefreshed={setStatus}
        />
      ) : (
        <button
          onClick={() => setPanelOpen(true)}
          className="glass absolute left-4 top-16 z-10 rounded-full border border-hairline/70 px-4 py-2 text-sm text-ink hover:text-white"
          title="접속 기록 패널 열기"
        >
          › 접속 기록
        </button>
      )}
    </div>
  );
}
