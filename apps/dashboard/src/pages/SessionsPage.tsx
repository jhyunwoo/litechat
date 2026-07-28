/**
 * 접속 기록 — 모든 사용자 접속 정보(사용자·IP·시간·위치·기기)를 한 번에 조회하는
 * 데이터 탐색기. 필터(사용자/플랫폼/IP/기간) + 정렬 + 페이지네이션.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  adminApi,
  type InsightsResult,
  type SessionRow,
  type SessionsParams,
  type SessionsResult,
  type UserVisit,
} from '../api';
import { SessionDetailModal } from './map/SessionDetailModal';
import { applyInsightsLocation, dateToEpoch, formatDate } from './map/shared';

function locationOf(row: SessionRow): string {
  return [row.city, row.region, row.country].filter(Boolean).join(', ') || '—';
}

const PLATFORM_OPTIONS = ['', 'web', 'lite', 'app'] as const;
const PAGE_SIZE = 50;

export default function SessionsPage() {
  const [users, setUsers] = useState<UserVisit[]>([]);
  const [result, setResult] = useState<SessionsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailSession, setDetailSession] = useState<SessionRow | null>(null);
  const [insights, setInsights] = useState<InsightsResult | null>(null);
  const [insightsBusy, setInsightsBusy] = useState(false);
  const [insightsError, setInsightsError] = useState('');

  // 필터/정렬/페이지 상태
  const [userId, setUserId] = useState('');
  const [platform, setPlatform] = useState('');
  const [ip, setIp] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sort, setSort] = useState<'created_at' | 'last_seen_at'>('created_at');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  useEffect(() => {
    void adminApi.usersVisits().then(setUsers);
  }, []);

  const load = useCallback(() => {
    const params: SessionsParams = {
      userId: userId ? Number(userId) : undefined,
      platform: platform || undefined,
      ip: ip.trim() || undefined,
      from: dateToEpoch(fromDate, false),
      to: dateToEpoch(toDate, true),
      sort,
      dir,
      page,
      pageSize: PAGE_SIZE,
    };
    setLoading(true);
    void adminApi
      .sessions(params)
      .then(setResult)
      .finally(() => setLoading(false));
  }, [userId, platform, ip, fromDate, toDate, sort, dir, page]);

  useEffect(() => {
    load();
  }, [load]);

  /** 필터가 바뀌면 1페이지로 돌아간다 */
  function withPageReset<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }

  function toggleSort(column: 'created_at' | 'last_seen_at') {
    if (sort === column) {
      setDir(dir === 'desc' ? 'asc' : 'desc');
    } else {
      setSort(column);
      setDir('desc');
    }
    setPage(1);
  }

  function openDetail(row: SessionRow) {
    setDetailSession(row);
    setInsights(null);
    setInsightsError('');
  }

  function lookupInsights(ip: string) {
    if (insightsBusy || ip === '') return;
    setInsightsBusy(true);
    setInsightsError('');
    void adminApi
      .insights(ip)
      .then((next) => {
        setInsights(next);
        setResult((current) =>
          current
            ? {
                ...current,
                rows: current.rows.map((row) => applyInsightsLocation(row, next.insights)),
              }
            : current,
        );
        setDetailSession((row) => row && applyInsightsLocation(row, next.insights));
      })
      .catch((err: Error) => setInsightsError(err.message))
      .finally(() => setInsightsBusy(false));
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;
  const sortIndicator = (column: string) => (sort === column ? (dir === 'desc' ? ' ↓' : ' ↑') : '');

  const inputClass =
    'rounded-md border border-hairline bg-shell px-3 py-1.5 text-sm outline-none focus:border-primary-soft';

  return (
    <div className="flex flex-col gap-4">
      {/* 필터 바 — 모바일에서는 2칸 그리드로 쌓이고, sm부터 한 줄로 흐른다 */}
      <div className="rounded-xl border border-hairline bg-card p-4">
        <div className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
          <label className="col-span-2 flex flex-col gap-1 text-xs text-ink-mute sm:col-auto">
            사용자
            <select
              value={userId}
              onChange={(e) => withPageReset(setUserId)(e.target.value)}
              className={`${inputClass} w-full sm:w-auto`}
            >
              <option value="">전체</option>
              {users.map((user) => (
                <option key={user.userId} value={user.userId}>
                  {user.nickname} (@{user.username})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-mute">
            플랫폼
            <select
              value={platform}
              onChange={(e) => withPageReset(setPlatform)(e.target.value)}
              className={`${inputClass} w-full sm:w-auto`}
            >
              {PLATFORM_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === '' ? '전체' : option}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-mute">
            IP (부분 일치)
            <input
              value={ip}
              onChange={(e) => withPageReset(setIp)(e.target.value)}
              placeholder="예: 121.128"
              className={`${inputClass} w-full sm:w-36`}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-mute">
            시작일
            <input
              type="date"
              value={fromDate}
              onChange={(e) => withPageReset(setFromDate)(e.target.value)}
              className={`${inputClass} w-full sm:w-auto`}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-mute">
            종료일
            <input
              type="date"
              value={toDate}
              onChange={(e) => withPageReset(setToDate)(e.target.value)}
              className={`${inputClass} w-full sm:w-auto`}
            />
          </label>
          <span className="col-span-2 text-xs text-ink-mute tnum sm:col-auto sm:ml-auto">
            {result ? `총 ${result.total.toLocaleString()}건` : ''}
            {loading ? ' · 불러오는 중…' : ''}
          </span>
        </div>
      </div>

      {/* 데이터 그리드 — 모바일에서는 행당 카드, sm부터 테이블 */}
      <div className="rounded-xl border border-hairline bg-card">
        <div className="max-h-[70dvh] overflow-y-auto sm:hidden">
          {result?.rows.map((row) => (
            <div key={row.id} className="border-b border-hairline/50 px-4 py-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="tnum">{formatDate(row.createdAt)}</span>
                <span className="rounded-full border border-hairline/70 px-1.5 py-0.5 text-[10px] text-ink-mute">
                  {row.platform}
                </span>
              </div>
              <div className="mt-1">
                {row.userId ? (
                  <>
                    {row.nickname} <span className="text-ink-mute">@{row.username}</span>
                  </>
                ) : (
                  <span className="text-ink-mute">비로그인</span>
                )}
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-ink-mute">
                <span className="tnum">{row.ip}</span>
                <span>{locationOf(row)}</span>
              </div>
              <div className="tnum mt-1 text-[11px] text-ink-mute">
                마지막 활동 {formatDate(row.lastSeenAt)}
              </div>
              {row.referrer && (
                <div className="mt-1 truncate text-[11px] text-ink-mute" title={row.referrer}>
                  리퍼러 {row.referrer}
                </div>
              )}
              <div className="mt-1 truncate text-[11px] text-ink-mute" title={row.userAgent}>
                {row.userAgent || '—'}
              </div>
              <button
                onClick={() => openDetail(row)}
                className="mt-2 rounded-md border border-hairline px-2.5 py-1 text-[11px] text-ink-mute hover:text-white focus-visible:ring-1 focus-visible:ring-primary-soft"
              >
                상세 정보
              </button>
            </div>
          ))}
        </div>
        <div className="hidden max-h-[70dvh] overflow-auto sm:block">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-card text-ink-mute">
              <tr className="border-b border-hairline">
                <th
                  className="cursor-pointer whitespace-nowrap px-4 py-2.5 font-normal hover:text-white"
                  onClick={() => toggleSort('created_at')}
                >
                  접속 시간{sortIndicator('created_at')}
                </th>
                <th
                  className="cursor-pointer whitespace-nowrap px-4 py-2.5 font-normal hover:text-white"
                  onClick={() => toggleSort('last_seen_at')}
                >
                  마지막 활동{sortIndicator('last_seen_at')}
                </th>
                <th className="whitespace-nowrap px-4 py-2.5 font-normal">사용자</th>
                <th className="whitespace-nowrap px-4 py-2.5 font-normal">플랫폼</th>
                <th className="whitespace-nowrap px-4 py-2.5 font-normal">IP</th>
                <th className="whitespace-nowrap px-4 py-2.5 font-normal">위치</th>
                <th className="whitespace-nowrap px-4 py-2.5 font-normal">리퍼러</th>
                <th className="px-4 py-2.5 font-normal">기기 (User-Agent)</th>
                <th className="whitespace-nowrap px-4 py-2.5 font-normal">상세</th>
              </tr>
            </thead>
            <tbody>
              {result?.rows.map((row) => (
                <tr key={row.id} className="border-b border-hairline/50 hover:bg-shell/50">
                  <td className="tnum whitespace-nowrap px-4 py-2">{formatDate(row.createdAt)}</td>
                  <td className="tnum whitespace-nowrap px-4 py-2 text-ink-mute">
                    {formatDate(row.lastSeenAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2">
                    {row.userId ? (
                      <>
                        {row.nickname} <span className="text-ink-mute">@{row.username}</span>
                      </>
                    ) : (
                      <span className="text-ink-mute">비로그인</span>
                    )}
                  </td>
                  <td className="px-4 py-2">{row.platform}</td>
                  <td className="tnum whitespace-nowrap px-4 py-2">{row.ip}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-ink-mute">{locationOf(row)}</td>
                  <td
                    className="max-w-40 truncate px-4 py-2 text-ink-mute xl:max-w-72"
                    title={row.referrer ?? ''}
                  >
                    {row.referrer ?? '—'}
                  </td>
                  {/* 와이드 화면에서는 UA를 더 길게 노출한다 */}
                  <td
                    className="max-w-72 truncate px-4 py-2 text-ink-mute xl:max-w-[36rem]"
                    title={row.userAgent}
                  >
                    {row.userAgent || '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2">
                    <button
                      onClick={() => openDetail(row)}
                      className="rounded-md border border-hairline px-2.5 py-1 text-[11px] text-ink-mute hover:text-white focus-visible:ring-1 focus-visible:ring-primary-soft"
                    >
                      상세 정보
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {result && result.rows.length === 0 && (
          <p className="py-10 text-center text-ink-mute">조건에 맞는 접속 기록이 없어요.</p>
        )}

        {/* 페이지네이션 */}
        <div className="flex items-center justify-between border-t border-hairline px-4 py-2.5 text-xs text-ink-mute">
          <span className="tnum">
            페이지 {result?.page ?? page} / {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="rounded-md border border-hairline px-3 py-1 hover:text-white disabled:opacity-40"
            >
              이전
            </button>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              className="rounded-md border border-hairline px-3 py-1 hover:text-white disabled:opacity-40"
            >
              다음
            </button>
          </div>
        </div>
      </div>
      {detailSession && (
        <SessionDetailModal
          context="sessions"
          session={detailSession}
          insights={insights}
          insightsBusy={insightsBusy}
          insightsError={insightsError}
          onLookupInsights={lookupInsights}
          onClose={() => setDetailSession(null)}
        />
      )}
    </div>
  );
}
