/**
 * 지도 — 뷰포트 전체 지도 + 글래스모피즘 접속 기록 패널.
 *
 * 지도 중심의 레이아웃: 지도가 화면을 가득 채우고, 접속 기록/사용자/진단은
 * 반투명 blur 패널로 지도 위에 떠서 지도가 비쳐 보인다 (PLAN.md).
 * 모바일에서는 패널이 하단 시트로 붙어 지도 위쪽 절반이 항상 보인다.
 *  - 패널의 기록을 클릭하면 지도가 그 위치로 이동하고 해당 핀이 강조된다.
 *  - 접속 기록은 사용자/플랫폼/IP/기간/조회 건수로 필터링할 수 있고(서버
 *    /sessions API가 전부 지원), 새로고침 버튼과 마지막 업데이트 시각을 패널에 표시한다.
 *  - 기록의 '상세 정보'는 오른쪽에 도킹되는 모달(SessionDetailModal)에서 보여준다.
 *    모달을 여는 것 자체는 무료고, 쿼리당 과금되는 GeoIP2 Insights는 모달 안의
 *    버튼으로만 호출된다 (같은 IP는 1주간 캐시 재사용).
 *  - Insights 결과가 있으면 그 좌표가 세션의 GeoLite2 좌표를 **대체**한다 —
 *    핀을 Insights 위치로 옮겨 찍고 반경 원도 Insights 기준으로 다시 그린다.
 *
 * 상태와 데이터 로딩은 전부 이 컨테이너가 소유하고, 하위(MapCanvas/AccessPanel/
 * SessionDetailModal)는 props로만 동작하는 표현 컴포넌트다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { SessionDetailModal } from './map/SessionDetailModal';
import {
  boundsOf,
  dateToEpoch,
  type MapTarget,
  type SelectedCircle,
  type SessionFilters,
} from './map/shared';

/** 실패를 조용히 삼키지 않기 위한 catch 핸들러 — 기존 "… 실패: 사유" 문구 형식을 따른다 */
function fail(set: (message: string) => void, what?: string) {
  return (err: Error) => set(what ? `${what} 불러오기 실패: ${err.message}` : err.message);
}

function isInsightsForSession(row: SessionRow, details: Insights): boolean {
  return row.ip.replace(/^::ffff:/i, '') === details.ip;
}

/** 방금 조회한 Insights 위치를 새로고침 전에 같은 IP의 세션들에 즉시 반영한다. */
function applyInsightsLocation(row: SessionRow, details: Insights): SessionRow {
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

const EMPTY_FILTERS: SessionFilters = {
  userId: '',
  platform: '',
  ip: '',
  fromDate: '',
  toDate: '',
  limit: 100,
};

export default function MapPage() {
  const [points, setPoints] = useState<GeoPoint[]>([]);
  const [status, setStatus] = useState<GeoStatus | null>(null);
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [configError, setConfigError] = useState('');
  /** 데이터 로딩 실패 — 패널 본문 최상단 배너로 어느 탭에서든 보인다 */
  const [loadError, setLoadError] = useState('');

  // 패널 UI 상태
  const [panelOpen, setPanelOpen] = useState(true);
  const [tab, setTab] = useState<PanelTab>('sessions');
  const [detailOpen, setDetailOpen] = useState(false);

  // 접속 기록(필터 적용, 최근순) → 기록 선택 → Insights
  const [users, setUsers] = useState<UserVisit[]>([]);
  const [filters, setFilters] = useState<SessionFilters>(EMPTY_FILTERS);
  /** 디바운스된 IP 검색어 — filters.ip를 그대로 쓰면 키 입력마다 /sessions를 호출한다 */
  const [ipQuery, setIpQuery] = useState('');
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionsTotal, setSessionsTotal] = useState(0);
  const [sessionsBusy, setSessionsBusy] = useState(false);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [selectedSession, setSelectedSession] = useState<SessionRow | null>(null);
  const [insights, setInsights] = useState<InsightsResult | null>(null);
  const [insightsBusy, setInsightsBusy] = useState(false);
  const [insightsError, setInsightsError] = useState('');
  const [target, setTarget] = useState<MapTarget | null>(null);

  // Insights 상시 수집 대상 + 선택한 사용자의 수집된 Insights
  const [watched, setWatched] = useState<Set<number>>(new Set());
  const [watchBusy, setWatchBusy] = useState(false);
  const [userInsights, setUserInsights] = useState<Insights[]>([]);

  // 사용자 필터를 새로 걸었을 때만 지도를 그 사용자의 최근 위치로 이동한다 (새로고침 때는 안 움직임)
  const panToUserRef = useRef(false);

  // 실패해도 조용히 멈추지 않도록 전부 catch한다 — 예전엔 config 실패 시
  // 지도가 "불러오는 중…"에서 영구 고착됐다.
  useEffect(() => {
    void adminApi.config().then(setConfig).catch(fail(setConfigError));
    void adminApi.usersVisits().then(setUsers).catch(fail(setLoadError, '사용자 목록'));
    void adminApi
      .watchList()
      .then((r) => setWatched(new Set(r.watched)))
      .catch(fail(setLoadError, '상시 수집 목록'));
    void adminApi.geo(30).then(setPoints).catch(fail(setLoadError, '지도 밀도'));
    void adminApi.geoStatus(30).then(setStatus).catch(fail(setLoadError, '진단 정보'));
  }, []);

  // IP는 타이핑이 멎은 뒤에만 조회한다 ('121.128' 입력 시 예전엔 요청이 7번 나갔다)
  useEffect(() => {
    const timer = setTimeout(() => setIpQuery(filters.ip.trim()), 300);
    return () => clearTimeout(timer);
  }, [filters.ip]);

  /** 서버로 보낼 조회 조건 — 이게 바뀔 때만 다시 불러온다 (filters.ip 자체는 의존하지 않는다) */
  const query = useMemo(
    () => ({
      userId: filters.userId ? Number(filters.userId) : undefined,
      platform: filters.platform || undefined,
      ip: ipQuery || undefined,
      from: dateToEpoch(filters.fromDate, false),
      to: dateToEpoch(filters.toDate, true),
      sort: 'created_at' as const,
      dir: 'desc' as const,
      pageSize: filters.limit,
    }),
    [filters.userId, filters.platform, filters.fromDate, filters.toDate, filters.limit, ipQuery],
  );

  /** 접속 기록 로드 — 조건이 바뀌거나 새로고침할 때 호출, 성공 시 마지막 업데이트 시각 기록 */
  const loadSessions = useCallback(() => {
    setSessionsBusy(true);
    // 배너는 "시도할 때" 지운다. 성공 시점에 지우면 같은 틱에 시작한 다른 요청
    // (지도 밀도 등)이 조금 뒤에 실패했을 때 그 오류를 덮어써 삼켜버린다.
    setLoadError('');
    void adminApi
      .sessions(query)
      .then((result) => {
        setSessions(result.rows);
        setSessionsTotal(result.total);
        setSessionsLoaded(true);
        setLastUpdated(Date.now());
        // 새 결과에 없는 기록의 선택은 무의미하다. 필터/건수 변경을 한 곳에서 균일하게
        // 처리하면서도 키 입력마다 선택이 풀리지는 않는다 (조회가 끝날 때만 판단).
        setSelectedSession((prev) =>
          prev === null || result.rows.some((row) => row.id === prev.id) ? prev : null,
        );
        if (panToUserRef.current) {
          panToUserRef.current = false;
          // 위치가 있는 가장 최근 기록으로 지도를 이동한다.
          const located = result.rows.find((row) => row.lat !== null);
          if (located) {
            setTarget({ kind: 'point', lat: located.lat!, lng: located.lon!, zoom: 6 });
          }
        }
      })
      .catch(fail(setLoadError, '접속 기록'))
      .finally(() => setSessionsBusy(false));
  }, [query]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Esc — 모달이 열려 있으면 모달이 캡처 단계에서 먼저 먹고, 없을 때만 선택이 풀린다
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') clearMapSelection();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function updateFilters(patch: Partial<SessionFilters>) {
    setFilters((prev) => ({ ...prev, ...patch }));
  }

  function loadUserInsights(userId: number) {
    void adminApi
      .insightsByUser(userId)
      .then((r) => setUserInsights(r.insights))
      .catch(fail(setLoadError, '수집된 Insights'));
  }

  /** 지도 선택 해제 — 핀/원 강조와 상세를 지운다 (수집된 Insights 칩 목록은 남긴다) */
  function clearMapSelection() {
    setSelectedSession(null);
    setInsights(null);
    setInsightsError('');
    setDetailOpen(false);
  }

  /** 선택/Insights 상태 초기화 — 필터가 바뀌면 이전 선택이 무의미해진다 */
  function clearSelection() {
    clearMapSelection();
    setUserInsights([]);
  }

  /** 사용자 필터 변경 ('' = 전체) — 그 사용자의 수집된 Insights도 함께 불러온다 */
  function changeUserFilter(userId: string) {
    clearSelection();
    panToUserRef.current = userId !== '';
    updateFilters({ userId });
    if (userId !== '') loadUserInsights(Number(userId));
  }

  /** 사용자 탭에서 사용자 선택 — 필터 적용 후 결과가 바로 보이도록 기록 탭으로 전환 */
  function selectUser(user: UserVisit) {
    setTab('sessions');
    changeUserFilter(String(user.userId));
  }

  /** 필터 전체 초기화 (조회 건수는 유지) */
  function resetFilters() {
    clearSelection();
    setFilters((prev) => ({ ...EMPTY_FILTERS, limit: prev.limit }));
  }

  /** 새로고침 — 접속 기록과 지도 오버레이(밀도 원/진단/사용자)를 전부 다시 불러온다 */
  function refresh() {
    loadSessions();
    void adminApi.geo(30).then(setPoints).catch(fail(setLoadError, '지도 밀도'));
    void adminApi.geoStatus(30).then(setStatus).catch(fail(setLoadError, '진단 정보'));
    void adminApi.usersVisits().then(setUsers).catch(fail(setLoadError, '사용자 목록'));
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
      // 예전엔 insightsError로 들어가서 사용자 탭의 실패가 기록 탭에서만 보였다
      .catch(fail(setLoadError, '상시 수집 설정'))
      .finally(() => setWatchBusy(false));
  }

  /** 기록/핀 선택 — 지도를 그 위치로 옮긴다. 모달이 열려 있으면 내용만 교체된다 */
  function selectSession(row: SessionRow) {
    setSelectedSession(row);
    setInsights(null);
    setInsightsError('');
    if (row.lat !== null && row.lon !== null) {
      setTarget({ kind: 'point', lat: row.lat, lng: row.lon, zoom: 10 });
    }
  }

  /** '상세 정보' — 모달만 연다. 과금되는 Insights는 모달 안에서 명시적으로 호출한다 */
  function openDetail(row: SessionRow) {
    selectSession(row);
    setDetailOpen(true);
  }

  function lookupInsights(ip: string) {
    if (insightsBusy || ip === '') return;
    setInsightsBusy(true);
    setInsightsError('');
    void adminApi
      .insights(ip)
      .then((result) => {
        setInsights(result);
        setSessions((rows) => rows.map((row) => applyInsightsLocation(row, result.insights)));
        setSelectedSession((row) => row && applyInsightsLocation(row, result.insights));
        // 밀도 원도 방금 저장된 Insights 위치로 다시 집계한다.
        void adminApi.geo(30).then(setPoints).catch(fail(setLoadError, '지도 밀도'));
        const { lat, lon } = result.insights;
        if (lat !== null && lon !== null) setTarget({ kind: 'point', lat, lng: lon, zoom: 11 });
      })
      .catch((err: Error) => setInsightsError(err.message))
      .finally(() => setInsightsBusy(false));
  }

  /** 수집된 Insights 칩 클릭 — 상세 모달 표시 + 지도 이동 (탭은 그대로 둔다) */
  function selectInsights(row: Insights) {
    setInsights({ cached: true, stale: false, insights: row });
    setInsightsError('');
    setSessions((sessions) => sessions.map((session) => applyInsightsLocation(session, row)));
    // 밀도 원도 이 Insights 위치로 다시 집계한다.
    void adminApi.geo(30).then(setPoints).catch(fail(setLoadError, '지도 밀도'));
    setSelectedSession(null);
    setDetailOpen(true);
    if (row.lat !== null && row.lon !== null) {
      setTarget({ kind: 'point', lat: row.lat, lng: row.lon, zoom: 11 });
    }
  }

  /** 밀도 지점 칩 클릭 — 그 지점으로 줌인 (세계 줌에서 도시로 파고드는 손잡이) */
  function selectPoint(point: GeoPoint) {
    setTarget({ kind: 'point', lat: point.lat, lng: point.lon, zoom: 10 });
  }

  /** '결과 전체 보기' — 필터 결과 핀이 전부 화면에 들어오도록 맞춘다 */
  function fitResults() {
    const box = boundsOf(sessions);
    if (box) {
      setTarget({ kind: 'bounds', box });
      return;
    }
    // 1건뿐이면 fitBounds가 최대 줌으로 튄다 — 그냥 그 점으로 이동한다
    const only = sessions.find((row) => row.lat !== null && row.lon !== null);
    if (only) setTarget({ kind: 'point', lat: only.lat!, lng: only.lon!, zoom: 10 });
  }

  const selectedUser = users.find((u) => String(u.userId) === filters.userId) ?? null;
  const locatedSessions = sessions.filter((row) => row.lat !== null && row.lon !== null);

  // Insights 상세 조회 결과의 좌표 — 서버에서 이미 기본 지도 위치에도 우선 반영되며,
  // 조회 직후에는 선택 위치를 별도 강조 핀으로 표시한다.
  const insightsData = insights?.insights ?? null;
  const insightsPin =
    insightsData && insightsData.lat !== null && insightsData.lon !== null
      ? { lat: insightsData.lat, lng: insightsData.lon }
      : null;
  // 선택 세션의 IP를 상세 조회한 경우 — 기존(GeoLite2) 핀은 숨기고 Insights 핀만 남긴다
  const replacesSelectedPin =
    insightsPin !== null &&
    insightsData !== null &&
    selectedSession !== null &&
    isInsightsForSession(selectedSession, insightsData);
  const visibleSessions =
    replacesSelectedPin && selectedSession
      ? locatedSessions.filter((row) => row.id !== selectedSession.id)
      : locatedSessions;

  // 선택한 기록의 정확도 원 — Insights(유료, 더 정확) 좌표/반경 우선, 없으면 세션의 GeoLite2 값
  const selectedCircle: SelectedCircle | null = (() => {
    if (insightsData && insightsData.lat !== null && insightsData.lon !== null) {
      const radiusKm =
        insightsData.accuracyRadius ??
        (selectedSession && isInsightsForSession(selectedSession, insightsData)
          ? selectedSession.accuracyKm
          : null);
      return radiusKm !== null
        ? { lat: insightsData.lat, lng: insightsData.lon, radiusKm }
        : null;
    }
    const s = selectedSession;
    if (s && s.lat !== null && s.lon !== null && s.accuracyKm !== null) {
      return { lat: s.lat, lng: s.lon, radiusKm: s.accuracyKm };
    }
    return null;
  })();

  // 세션이 풀렸고 Insights도 없으면 보여줄 게 없으므로 모달은 자동으로 닫힌다
  const showDetail = detailOpen && (selectedSession !== null || insights !== null);

  return (
    <div className="relative h-full w-full">
      <MapCanvas
        config={config}
        configError={configError}
        target={target}
        points={points}
        locatedSessions={visibleSessions}
        selectedSessionId={selectedSession?.id ?? null}
        insightsPin={insightsPin}
        selectedCircle={selectedCircle}
        onSelectSession={selectSession}
        onSelectPoint={selectPoint}
      />
      {panelOpen ? (
        <AccessPanel
          tab={tab}
          onTab={setTab}
          onClose={() => setPanelOpen(false)}
          loadError={loadError}
          sessions={sessions}
          sessionsTotal={sessionsTotal}
          sessionsBusy={sessionsBusy}
          sessionsLoaded={sessionsLoaded}
          lastUpdated={lastUpdated}
          filters={filters}
          onFilters={updateFilters}
          onUserFilter={changeUserFilter}
          onResetFilters={resetFilters}
          onRefresh={refresh}
          onFitResults={fitResults}
          canFitResults={locatedSessions.length > 0}
          selectedSession={selectedSession}
          selectedUser={selectedUser}
          insights={insights}
          onSelectSession={selectSession}
          onOpenDetail={openDetail}
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
          className="glass animate-fade-in absolute bottom-4 left-4 z-10 rounded-full border border-hairline/70 px-4 py-2 text-sm text-ink hover:text-white focus-visible:ring-1 focus-visible:ring-primary-soft sm:bottom-auto sm:top-24 lg:top-16"
          title="접속 기록 패널 열기"
        >
          › 접속 기록
        </button>
      )}
      {showDetail && (
        <SessionDetailModal
          session={selectedSession}
          insights={insights}
          insightsBusy={insightsBusy}
          insightsError={insightsError}
          onLookupInsights={lookupInsights}
          onClose={() => setDetailOpen(false)}
        />
      )}
    </div>
  );
}
