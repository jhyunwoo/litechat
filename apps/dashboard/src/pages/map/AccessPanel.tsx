/**
 * 접속 기록 글래스 패널 — 지도 왼쪽에 떠 있는 반투명(blur) 패널.
 *
 * 탭 3개로 기존 기능을 전부 담는다:
 *  - 접속 기록: 최근 세션 목록(기본 전체, 사용자 선택 시 필터) + Insights 상세
 *  - 사용자: 사용자 목록 + Insights 상시 수집(★) 토글 + 수집된 Insights 칩
 *  - 진단: GeoIP DB 상태/실패 IP 표본
 *
 * 기록을 클릭하면 지도의 해당 핀이 잉크 블랙으로 강조되고, 핀을 클릭하면
 * 목록의 해당 행이 하이라이트되며 화면 안으로 스크롤된다.
 */
import { useEffect, useRef } from 'react';
import type {
  GeoStatus,
  Insights,
  InsightsResult,
  SessionRow,
  UserVisit,
} from '../../api';
import { GeoDiagnostics } from './GeoDiagnostics';
import { InsightsCard } from './InsightsCard';
import { formatDate } from './shared';

export type PanelTab = 'sessions' | 'users' | 'diagnostics';

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'sessions', label: '접속 기록' },
  { id: 'users', label: '사용자' },
  { id: 'diagnostics', label: '진단' },
];

interface AccessPanelProps {
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  onClose: () => void;

  // 접속 기록 탭
  sessions: SessionRow[];
  selectedSession: SessionRow | null;
  selectedUser: UserVisit | null;
  insights: InsightsResult | null;
  insightsBusy: boolean;
  insightsError: string;
  onSelectSession: (row: SessionRow) => void;
  onLookupInsights: (ip: string) => void;
  onClearUser: () => void;

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
    <aside className="glass pointer-events-auto absolute bottom-4 left-4 top-16 z-10 flex w-[400px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-hairline/70">
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
          ‹
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
  selectedSession,
  selectedUser,
  insights,
  insightsBusy,
  insightsError,
  onSelectSession,
  onLookupInsights,
  onClearUser,
}: AccessPanelProps) {
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  // 지도 핀 클릭 등으로 선택이 바뀌면 목록에서 해당 행이 보이도록 스크롤한다
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedSession?.id]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs text-ink-mute">
        <span>
          {selectedUser
            ? `${selectedUser.nickname}의 접속 기록 (최근 ${sessions.length}건)`
            : `최근 접속 기록 ${sessions.length}건`}
        </span>
        {selectedUser && (
          <button onClick={onClearUser} className="rounded-full border border-hairline px-2 py-0.5 hover:text-white">
            필터 해제
          </button>
        )}
      </div>

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
