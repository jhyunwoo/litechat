/**
 * 접속 기록 글래스 패널 — 지도 위에 떠 있는 반투명(blur) 패널.
 * 데스크톱에서는 지도 왼쪽에 세로로 붙고, 모바일에서는 하단 시트가 되어
 * 지도 위쪽 절반이 항상 보인다.
 *
 * 탭 3개로 기존 기능을 전부 담는다:
 *  - 접속 기록: 최근 세션 목록 + 필터(사용자/플랫폼/IP/기간/조회 건수) +
 *    새로고침/마지막 업데이트 + Insights 상세
 *  - 사용자: 사용자 목록 + Insights 상시 수집(★) 토글 + 수집된 Insights 칩
 *  - 진단: GeoIP DB 상태/실패 IP 표본
 *
 * 기록을 클릭하면 지도의 해당 핀이 강조되고, 핀을 클릭하면
 * 목록의 해당 행이 하이라이트되며 화면 안으로 스크롤된다.
 */
import { useEffect, useRef, useState } from 'react';
import type {
  GeoStatus,
  Insights,
  InsightsResult,
  SessionRow,
  UserVisit,
} from '../../api';
import { GeoDiagnostics } from './GeoDiagnostics';
import { InsightsCard } from './InsightsCard';
import { formatDate, formatTime, LIMIT_OPTIONS, type SessionFilters } from './shared';

export type PanelTab = 'sessions' | 'users' | 'diagnostics';

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'sessions', label: '접속 기록' },
  { id: 'users', label: '사용자' },
  { id: 'diagnostics', label: '진단' },
];

const PLATFORM_OPTIONS = ['', 'web', 'lite', 'app'] as const;

/** 글래스 패널 위 폼 컨트롤 — 반투명 검정 배경으로 지도가 살짝 비친다 */
const inputClass =
  'w-full rounded-md border border-hairline bg-black/40 px-2.5 py-1.5 text-xs text-ink outline-none focus:border-primary-soft';

interface AccessPanelProps {
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  onClose: () => void;

  // 접속 기록 탭 — 목록/필터/새로고침
  sessions: SessionRow[];
  sessionsTotal: number;
  sessionsBusy: boolean;
  /** 마지막으로 접속 기록을 불러온 시각 (ms epoch) — 아직 없으면 null */
  lastUpdated: number | null;
  filters: SessionFilters;
  onFilters: (patch: Partial<SessionFilters>) => void;
  /** 사용자 필터는 Insights 로딩 등 부수효과가 있어 별도 핸들러를 쓴다 */
  onUserFilter: (userId: string) => void;
  onResetFilters: () => void;
  onRefresh: () => void;
  selectedSession: SessionRow | null;
  selectedUser: UserVisit | null;
  insights: InsightsResult | null;
  insightsBusy: boolean;
  insightsError: string;
  onSelectSession: (row: SessionRow) => void;
  onLookupInsights: (ip: string) => void;

  // 사용자 탭
  users: UserVisit[];
  watched: Set<number>;
  watchBusy: boolean;
  userInsights: Insights[];
  onSelectUser: (user: UserVisit) => void;
  onToggleWatch: (user: UserVisit) => void;
  onSelectInsights: (row: Insights) => void;

  // 진단 탭
  status: GeoStatus | null;
  onStatusRefreshed: (status: GeoStatus) => void;
}

export function AccessPanel(props: AccessPanelProps) {
  const { tab, onTab, onClose } = props;
  return (
    <aside
      className={
        // 모바일: 하단 시트(높이 고정) / sm+: 왼쪽 세로 패널 (top은 헤더 높이를 따라 lg에서 한 번 더 올라간다)
        'glass pointer-events-auto absolute bottom-2 left-2 right-2 z-10 flex h-[48dvh] flex-col overflow-hidden rounded-2xl border border-hairline/70 ' +
        'sm:bottom-4 sm:left-4 sm:right-auto sm:top-24 sm:h-auto sm:w-[400px] sm:max-w-[calc(100vw-2rem)] lg:top-16'
      }
    >
      <div className="flex items-center gap-1 border-b border-hairline/60 px-3 py-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => onTab(t.id)}
            className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
              tab === t.id ? 'bg-primary text-black' : 'text-ink-mute hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={onClose}
          className="ml-auto rounded-full px-2 py-1 text-ink-mute hover:text-white"
          title="패널 접기"
          aria-label="패널 접기"
        >
          <span className="sm:hidden">∨</span>
          <span className="hidden sm:inline">‹</span>
        </button>
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto p-3">
        {tab === 'sessions' && <SessionsTab {...props} />}
        {tab === 'users' && <UsersTab {...props} />}
        {tab === 'diagnostics' &&
          (props.status ? (
            <GeoDiagnostics status={props.status} onRefreshed={props.onStatusRefreshed} />
          ) : (
            <p className="py-6 text-center text-xs text-ink-mute">진단 정보를 불러오는 중…</p>
          ))}
      </div>
    </aside>
  );
}

function SessionsTab({
  sessions,
  sessionsTotal,
  sessionsBusy,
  lastUpdated,
  filters,
  onFilters,
  onUserFilter,
  onResetFilters,
  onRefresh,
  selectedSession,
  selectedUser,
  insights,
  insightsBusy,
  insightsError,
  onSelectSession,
  onLookupInsights,
  users,
}: AccessPanelProps) {
  const selectedRef = useRef<HTMLButtonElement | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // 지도 핀 클릭 등으로 선택이 바뀌면 목록에서 해당 행이 보이도록 스크롤한다
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedSession?.id]);

  const hasFilter =
    filters.userId !== '' ||
    filters.platform !== '' ||
    filters.ip !== '' ||
    filters.fromDate !== '' ||
    filters.toDate !== '';

  return (
    <div className="flex flex-col gap-2">
      {/* 헤더: 건수/필터 요약 + 필터 토글 + 새로고침 */}
      <div className="flex items-center justify-between gap-2 text-xs text-ink-mute">
        <span>
          {selectedUser ? `${selectedUser.nickname}의 접속 기록` : '접속 기록'}{' '}
          <span className="tnum">
            {sessions.length}건{sessionsTotal > sessions.length ? ` / 전체 ${sessionsTotal}건` : ''}
          </span>
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => setFiltersOpen(!filtersOpen)}
            className={`rounded-full border px-2.5 py-1 transition-colors ${
              filtersOpen || hasFilter
                ? 'border-primary/70 text-white'
                : 'border-hairline hover:text-white'
            }`}
            title="접속 기록 필터"
          >
            필터{hasFilter ? ' ●' : ''}
          </button>
          <button
            onClick={onRefresh}
            disabled={sessionsBusy}
            className="rounded-full border border-hairline px-2.5 py-1 hover:text-white disabled:opacity-40"
            title="접속 기록과 지도 데이터를 다시 불러옵니다"
          >
            {sessionsBusy ? '갱신 중…' : '↻ 새로고침'}
          </button>
        </div>
      </div>
      <div className="tnum text-[11px] text-ink-mute">
        마지막 업데이트 {lastUpdated !== null ? formatTime(lastUpdated) : '—'}
      </div>

      {filtersOpen && (
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-hairline/60 bg-white/5 p-3">
          <label className="col-span-2 flex flex-col gap-1 text-[11px] text-ink-mute">
            사용자
            <select
              value={filters.userId}
              onChange={(e) => onUserFilter(e.target.value)}
              className={inputClass}
            >
              <option value="">전체</option>
              {users.map((user) => (
                <option key={user.userId} value={user.userId}>
                  {user.nickname} (@{user.username})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-ink-mute">
            플랫폼
            <select
              value={filters.platform}
              onChange={(e) => onFilters({ platform: e.target.value })}
              className={inputClass}
            >
              {PLATFORM_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === '' ? '전체' : option}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-ink-mute">
            조회 건수
            <select
              value={filters.limit}
              onChange={(e) => onFilters({ limit: Number(e.target.value) })}
              className={inputClass}
            >
              {LIMIT_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}건
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-[11px] text-ink-mute">
            IP (부분 일치)
            <input
              value={filters.ip}
              onChange={(e) => onFilters({ ip: e.target.value })}
              placeholder="예: 121.128"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-ink-mute">
            시작일
            <input
              type="date"
              value={filters.fromDate}
              onChange={(e) => onFilters({ fromDate: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-ink-mute">
            종료일
            <input
              type="date"
              value={filters.toDate}
              onChange={(e) => onFilters({ toDate: e.target.value })}
              className={inputClass}
            />
          </label>
          {hasFilter && (
            <button
              onClick={onResetFilters}
              className="col-span-2 rounded-md border border-hairline px-3 py-1.5 text-xs text-ink-mute hover:text-white"
            >
              필터 초기화
            </button>
          )}
        </div>
      )}

      {insightsError !== '' && (
        <p className="rounded-md border border-danger/40 px-3 py-2 text-xs text-danger">
          Insights 조회 실패: {insightsError}
        </p>
      )}

      {insights && <InsightsCard result={insights} />}

      <div className="flex flex-col gap-1">
        {sessions.map((row) => {
          const selected = selectedSession?.id === row.id;
          return (
            <button
              key={row.id}
              ref={selected ? selectedRef : undefined}
              onClick={() => onSelectSession(row)}
              className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                selected
                  ? 'border-primary/70 bg-white/15'
                  : 'border-transparent hover:bg-white/8'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="tnum">{formatDate(row.createdAt)}</span>
                <span className="rounded-full border border-hairline/70 px-1.5 py-0.5 text-[10px] text-ink-mute">
                  {row.platform}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-ink-mute">
                <span className="tnum">{row.ip}</span>
                <span>
                  {row.lat === null
                    ? '위치 없음'
                    : [row.city, row.country].filter(Boolean).join(', ') || '좌표만 있음'}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-ink-mute">
                <span>{row.nickname ? `${row.nickname} @${row.username}` : '비로그인'}</span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectSession(row);
                    onLookupInsights(row.ip);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      onSelectSession(row);
                      onLookupInsights(row.ip);
                    }
                  }}
                  aria-disabled={insightsBusy}
                  className={`rounded-md border border-hairline px-2 py-0.5 hover:text-white ${insightsBusy ? 'opacity-40' : ''}`}
                  title="GeoIP2 Insights 상세 조회 (유료 API — 같은 IP는 1주 캐시)"
                >
                  상세 조회
                </span>
              </div>
            </button>
          );
        })}
        {sessions.length === 0 && (
          <p className="py-6 text-center text-xs text-ink-mute">접속 기록이 없어요.</p>
        )}
      </div>
    </div>
  );
}

function UsersTab({
  users,
  watched,
  watchBusy,
  userInsights,
  selectedUser,
  insights,
  onSelectUser,
  onToggleWatch,
  onSelectInsights,
}: AccessPanelProps) {
  return (
    <div className="flex flex-col gap-2">
      {selectedUser && (
        <div className="rounded-lg border border-hairline/60 bg-white/5 p-3">
          <div className="mb-2 text-xs">
            {selectedUser.nickname}
            <span className="ml-1 text-ink-mute">@{selectedUser.username}</span>
          </div>
          <button
            onClick={() => onToggleWatch(selectedUser)}
            disabled={watchBusy}
            className={`rounded-md border px-3 py-1.5 text-xs disabled:opacity-40 ${
              watched.has(selectedUser.userId)
                ? 'border-ink/60 text-ink'
                : 'border-hairline text-ink-mute hover:text-white'
            }`}
            title="켜면 이 사용자의 모든 새 접속에 대해 GeoIP2 Insights를 자동 수집합니다 (같은 IP는 1주 캐시 재사용)"
          >
            {watched.has(selectedUser.userId)
              ? '★ Insights 상시 수집 중 — 해제'
              : '☆ Insights 상시 수집 켜기'}
          </button>
          {/* 이 사용자의 접속 IP에 대해 저장된 Insights — 클릭하면 상세 카드 + 지도 이동 */}
          {userInsights.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {userInsights.map((row) => (
                <button
                  key={row.ip}
                  onClick={() => onSelectInsights(row)}
                  className={`rounded-full border px-2.5 py-1 text-xs ${
                    insights?.insights.ip === row.ip
                      ? 'border-primary text-white'
                      : 'border-hairline text-ink-mute hover:text-white'
                  }`}
                >
                  <span className="tnum">{row.ip}</span>
                  <span className="ml-1 opacity-70">
                    {[row.city, row.country].filter(Boolean).join(', ') || '위치 없음'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1">
        {users.map((user) => (
          <button
            key={user.userId}
            onClick={() => onSelectUser(user)}
            className={`rounded-md px-3 py-2 text-left text-sm transition-colors ${
              selectedUser?.userId === user.userId
                ? 'bg-primary text-black'
                : 'text-ink-mute hover:bg-white/8 hover:text-white'
            }`}
          >
            {watched.has(user.userId) && (
              <span className="mr-1" title="Insights 상시 수집 중">
                ★
              </span>
            )}
            {user.nickname}
            <span className="ml-1 text-xs opacity-70">@{user.username}</span>
            <span className="tnum float-right text-xs opacity-70">{user.sessionCount}</span>
          </button>
        ))}
        {users.length === 0 && <p className="py-4 text-center text-xs text-ink-mute">없음</p>}
      </div>
    </div>
  );
}
