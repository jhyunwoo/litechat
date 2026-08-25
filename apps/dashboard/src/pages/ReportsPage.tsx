import { useCallback, useEffect, useState } from 'react';
import { adminApi, type ContentReport } from '../api';

const REASONS: Record<ContentReport['reason'], string> = {
  harassment: '괴롭힘',
  hate: '혐오 표현',
  sexual: '성적 콘텐츠',
  violence: '폭력',
  spam: '스팸',
  other: '기타',
};

export default function ReportsPage() {
  const [status, setStatus] = useState<ContentReport['status']>('open');
  const [reports, setReports] = useState<ContentReport[]>([]);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    void adminApi
      .reports(status)
      .then((result) => setReports(result.reports))
      .catch(() => setError('신고 목록을 불러오지 못했습니다.'));
  }, [status]);
  useEffect(load, [load]);

  async function resolve(id: number, next: 'reviewed' | 'dismissed' | 'actioned') {
    try {
      await adminApi.resolveReport(id, next);
      load();
    } catch {
      setError('신고 상태를 변경하지 못했습니다.');
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="display text-2xl">신고 검토</h2>
          <p className="text-sm text-ink-mute">
            사용자 신고의 근거 메시지와 처리 상태를 관리합니다.
          </p>
        </div>
        <label className="text-sm text-ink-mute">
          상태{' '}
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ContentReport['status'])}
            className="ml-2 rounded-md border border-hairline bg-shell px-3 py-2 text-ink"
          >
            <option value="open">미처리</option>
            <option value="reviewed">검토됨</option>
            <option value="dismissed">기각</option>
            <option value="actioned">조치함</option>
          </select>
        </label>
      </div>
      {error && (
        <button onClick={load} className="text-danger underline" role="alert">
          {error} 다시 시도
        </button>
      )}
      {reports.length === 0 ? (
        <p className="rounded-xl border border-hairline bg-card p-6 text-center text-ink-mute">
          해당 상태의 신고가 없습니다.
        </p>
      ) : (
        reports.map((report) => (
          <article key={report.id} className="rounded-xl border border-hairline bg-card p-5">
            <div className="flex flex-wrap justify-between gap-2">
              <strong>
                #{report.id} · {REASONS[report.reason]}
              </strong>
              <time className="text-sm text-ink-mute">
                {new Date(report.createdAt * 1000).toLocaleString('ko-KR')}
              </time>
            </div>
            <p className="mt-2 text-sm">
              <span className="text-ink-mute">신고자</span> @{report.reporterUsername} →{' '}
              <span className="text-ink-mute">대상</span> @{report.reportedUsername}
            </p>
            {report.messageContent && (
              <blockquote className="mt-3 rounded-md border-l-2 border-primary-soft bg-shell p-3 text-sm break-words">
                {report.messageKind === 'i'
                  ? `[이미지 ID] ${report.messageContent}`
                  : report.messageContent}
              </blockquote>
            )}
            {report.details && <p className="mt-2 text-sm text-ink-mute">설명: {report.details}</p>}
            {status === 'open' && (
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => void resolve(report.id, 'reviewed')}
                  className="rounded-full border border-hairline px-4 py-2"
                >
                  검토됨
                </button>
                <button
                  onClick={() => void resolve(report.id, 'dismissed')}
                  className="rounded-full border border-hairline px-4 py-2"
                >
                  기각
                </button>
                <button
                  onClick={() => void resolve(report.id, 'actioned')}
                  className="rounded-full bg-primary px-4 py-2 text-black"
                >
                  조치 완료
                </button>
              </div>
            )}
          </article>
        ))
      )}
    </section>
  );
}
