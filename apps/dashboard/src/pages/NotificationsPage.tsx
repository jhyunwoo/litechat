/**
 * 알림 발송/수신 로그 — 웹/앱 푸시가 실제로 나갔는지, 도착했는지 확인하는 데이터 탐색기.
 * 필터(수신자/채널/발송상태/수신상태/기간) + 정렬 + 페이지네이션.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  adminApi,
  type NotificationsParams,
  type NotificationsResult,
  type NotificationSummary,
  type UserVisit,
} from '../api';
import { KpiCard } from '../components/KpiCard';

function formatDate(epochSeconds: number | null): string {
  if (epochSeconds === null) return '—';
  return new Date(epochSeconds * 1000).toLocaleString('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** 초 단위 값을 "12초"/"3분"/"2시간" 형태로 */
function formatLatency(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${Math.round(seconds)}초`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}분`;
  return `${Math.round(seconds / 3600)}시간`;
}

/** yyyy-mm-dd(로컬) → epoch 초. endOfDay면 그날 23:59:59 */
function dateToEpoch(value: string, endOfDay: boolean): number | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T${endOfDay ? '23:59:59' : '00:00:00'}`);
  return Math.floor(date.getTime() / 1000);
}

const CHANNEL_LABEL: Record<string, string> = { web: '웹', expo: '앱' };
const SENT_STATUS_LABEL: Record<string, string> = { ok: '성공', error: '오류', expired: '만료' };
const RECEIPT_STATUS_LABEL: Record<string, string> = { pending: '대기중', ok: '접수확인', error: '오류' };
const RECEIVED_STATUS_LABEL: Record<string, string> = {
  received: '수신함',
  pending: '대기중',
  presumed_lost: '미수신 추정',
  'n-a': '발송 실패',
};

function sentBadgeClass(status: string): string {
  if (status === 'ok') return 'border-emerald-400/40 text-emerald-400';
  if (status === 'expired') return 'border-amber-400/60 text-amber-400';
  return 'border-danger/40 text-danger';
}

function receivedBadgeClass(status: string): string {
  if (status === 'received') return 'border-emerald-400/40 text-emerald-400';
  if (status === 'pending') return 'border-amber-400/60 text-amber-400';
  if (status === 'presumed_lost') return 'border-danger/40 text-danger';
  return 'border-hairline text-ink-mute';
}

function Badge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${className}`}>
      {label}
    </span>
  );
}

const CHANNEL_OPTIONS = ['', 'web', 'expo'] as const;
const SENT_STATUS_OPTIONS = ['', 'ok', 'error', 'expired'] as const;
const RECEIVED_STATUS_OPTIONS = ['', 'received', 'pending', 'presumed_lost', 'n-a'] as const;
const PAGE_SIZE = 50;

export default function NotificationsPage() {
  const [users, setUsers] = useState<UserVisit[]>([]);
  const [result, setResult] = useState<NotificationsResult | null>(null);
  const [summary, setSummary] = useState<NotificationSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const [userId, setUserId] = useState('');
  const [channel, setChannel] = useState('');
  const [sentStatus, setSentStatus] = useState('');
  const [receivedStatus, setReceivedStatus] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sort, setSort] = useState<'sent_at' | 'received_at'>('sent_at');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  useEffect(() => {
    void adminApi.usersVisits().then(setUsers);
    void adminApi.notificationsSummary(30).then(setSummary);
  }, []);

  const load = useCallback(() => {
    const params: NotificationsParams = {
      userId: userId ? Number(userId) : undefined,
      channel: channel || undefined,
      sentStatus: sentStatus || undefined,
      receivedStatus: receivedStatus || undefined,
      from: dateToEpoch(fromDate, false),
      to: dateToEpoch(toDate, true),
      sort,
      dir,
      page,
      pageSize: PAGE_SIZE,
    };
    setLoading(true);
    void adminApi
      .notifications(params)
      .then(setResult)
      .finally(() => setLoading(false));
  }, [userId, channel, sentStatus, receivedStatus, fromDate, toDate, sort, dir, page]);

  useEffect(() => {
    load();
  }, [load]);

  function withPageReset<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }

  function toggleSort(column: 'sent_at' | 'received_at') {
    if (sort === column) {
      setDir(dir === 'desc' ? 'asc' : 'desc');
    } else {
      setSort(column);
      setDir('desc');
    }
    setPage(1);
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;
  const sortIndicator = (column: string) => (sort === column ? (dir === 'desc' ? ' ↓' : ' ↑') : '');
  const inputClass =
    'rounded-md border border-hairline bg-shell px-3 py-1.5 text-sm outline-none focus:border-primary-soft';
  const okCount = summary?.byStatus.find((s) => s.status === 'ok')?.count ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="발송 건수 (30일)" value={summary?.totalSent ?? '–'} />
        <KpiCard
          label="발송 성공률"
          value={summary ? `${Math.round((okCount / Math.max(1, summary.totalSent)) * 100)}%` : '–'}
        />
        <KpiCard
          label="수신 확인율"
          value={summary ? `${Math.round(summary.receivedRate * 100)}%` : '–'}
        />
        <KpiCard
          label="평균 수신 지연"
          value={summary ? formatLatency(summary.avgLatencySeconds) : '–'}
        />
      </div>

      {/* 필터 바 */}
      <div className="rounded-xl border border-hairline bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-ink-mute">
            수신자
            <select
              value={userId}
              onChange={(e) => withPageReset(setUserId)(e.target.value)}
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
          <label className="flex flex-col gap-1 text-xs text-ink-mute">
            채널
            <select
              value={channel}
              onChange={(e) => withPageReset(setChannel)(e.target.value)}
              className={inputClass}
            >
              {CHANNEL_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === '' ? '전체' : CHANNEL_LABEL[option]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-mute">
            발송상태
            <select
              value={sentStatus}
              onChange={(e) => withPageReset(setSentStatus)(e.target.value)}
              className={inputClass}
            >
              {SENT_STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === '' ? '전체' : SENT_STATUS_LABEL[option]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-mute">
            수신상태
            <select
              value={receivedStatus}
              onChange={(e) => withPageReset(setReceivedStatus)(e.target.value)}
              className={inputClass}
            >
              {RECEIVED_STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === '' ? '전체' : RECEIVED_STATUS_LABEL[option]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-mute">
            시작일
            <input
              type="date"
              value={fromDate}
              onChange={(e) => withPageReset(setFromDate)(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-mute">
            종료일
            <input
              type="date"
              value={toDate}
              onChange={(e) => withPageReset(setToDate)(e.target.value)}
              className={inputClass}
            />
          </label>
          <span className="ml-auto text-xs text-ink-mute tnum">
            {result ? `총 ${result.total.toLocaleString()}건` : ''}
            {loading ? ' · 불러오는 중…' : ''}
          </span>
        </div>
      </div>

      {/* 데이터 그리드 */}
      <div className="rounded-xl border border-hairline bg-card">
        <div className="max-h-[600px] overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-card text-ink-mute">
              <tr className="border-b border-hairline">
                <th
                  className="cursor-pointer whitespace-nowrap px-4 py-2.5 font-normal hover:text-white"
                  onClick={() => toggleSort('sent_at')}
                >
                  발송시각{sortIndicator('sent_at')}
                </th>
                <th className="whitespace-nowrap px-4 py-2.5 font-normal">수신자</th>
                <th className="whitespace-nowrap px-4 py-2.5 font-normal">채널</th>
                <th className="whitespace-nowrap px-4 py-2.5 font-normal">발송상태</th>
                <th className="whitespace-nowrap px-4 py-2.5 font-normal">영수증</th>
                <th
                  className="cursor-pointer whitespace-nowrap px-4 py-2.5 font-normal hover:text-white"
                  onClick={() => toggleSort('received_at')}
                >
                  수신시각{sortIndicator('received_at')}
                </th>
                <th className="whitespace-nowrap px-4 py-2.5 font-normal">수신여부</th>
                <th className="whitespace-nowrap px-4 py-2.5 font-normal">지연</th>
                <th className="px-4 py-2.5 font-normal">미리보기</th>
              </tr>
            </thead>
            <tbody>
              {result?.rows.map((row) => (
                <tr key={row.id} className="border-b border-hairline/50 hover:bg-shell/50">
                  <td className="tnum whitespace-nowrap px-4 py-2">{formatDate(row.sentAt)}</td>
                  <td className="whitespace-nowrap px-4 py-2">
                    {row.nickname ?? '—'} <span className="text-ink-mute">@{row.username ?? '?'}</span>
                  </td>
                  <td className="px-4 py-2">{CHANNEL_LABEL[row.channel] ?? row.channel}</td>
                  <td className="px-4 py-2" title={row.sentError ?? ''}>
                    <Badge
                      label={SENT_STATUS_LABEL[row.sentStatus] ?? row.sentStatus}
                      className={sentBadgeClass(row.sentStatus)}
                    />
                  </td>
                  <td className="px-4 py-2 text-ink-mute">
                    {row.receiptStatus ? (RECEIPT_STATUS_LABEL[row.receiptStatus] ?? row.receiptStatus) : '—'}
                  </td>
                  <td className="tnum whitespace-nowrap px-4 py-2 text-ink-mute">
                    {formatDate(row.receivedAt)}
                  </td>
                  <td className="px-4 py-2">
                    <Badge
                      label={RECEIVED_STATUS_LABEL[row.receivedStatus] ?? row.receivedStatus}
                      className={receivedBadgeClass(row.receivedStatus)}
                    />
                  </td>
                  <td className="tnum whitespace-nowrap px-4 py-2 text-ink-mute">
                    {row.receivedAt !== null ? formatLatency(row.receivedAt - row.sentAt) : '—'}
                  </td>
                  <td className="max-w-72 truncate px-4 py-2 text-ink-mute" title={row.bodyPreview}>
                    {row.bodyPreview || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {result && result.rows.length === 0 && (
            <p className="py-10 text-center text-ink-mute">조건에 맞는 알림 기록이 없어요.</p>
          )}
        </div>

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
    </div>
  );
}
