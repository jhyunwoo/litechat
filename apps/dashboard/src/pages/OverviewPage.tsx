/**
 * 개요 — KPI 카드 + 방문/이벤트 시계열 + 플랫폼 분포
 *
 * 와이드 화면 활용: KPI를 한 행(최대 6칸)으로 펼치고, 시계열(2/3)과
 * 플랫폼 막대(1/3)를 나란히 배치한다.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { adminApi, type Overview, type TimeseriesPoint } from '../api';
import { KpiCard } from '../components/KpiCard';

// recharts(brotli 85 KB)는 KPI 숫자가 그려진 뒤에 따라오면 된다 — 기본 라우트의
// 초기 전송량에서 빼기 위해 차트 영역만 지연 로드한다.
const OverviewCharts = lazy(() => import('./overview/OverviewCharts'));

/** 차트가 도착하기 전 자리를 잡아 두는 플레이스홀더 — 실제 차트와 같은 높이라 레이아웃이 흔들리지 않는다 */
function ChartsFallback() {
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="rounded-xl border border-hairline bg-card p-4 sm:p-5 xl:col-span-2">
        <h2 className="mb-4 text-sm text-ink-mute">일별 방문/이벤트 추이 (30일)</h2>
        <div className="h-64 sm:h-80" />
      </div>
      <div className="rounded-xl border border-hairline bg-card p-4 sm:p-5">
        <h2 className="mb-4 text-sm text-ink-mute">플랫폼별 세션 (30일)</h2>
        <div className="h-64 sm:h-80" />
      </div>
    </div>
  );
}

export default function OverviewPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [series, setSeries] = useState<TimeseriesPoint[]>([]);

  useEffect(() => {
    void adminApi.overview(30).then(setOverview);
    void adminApi.timeseries(30).then(setSeries);
  }, []);

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="전체 세션 (30일)" value={overview?.sessions ?? '–'} />
        <KpiCard label="순 방문자 (30일)" value={overview?.visitors ?? '–'} />
        <KpiCard label="로그인 세션" value={overview?.loggedInSessions ?? '–'} />
        {/* 플랫폼별 세션 — 한 칸에 욱여넣던 것을 카드 하나씩으로 펼친다 */}
        {(overview?.byPlatform ?? []).map((p) => (
          <KpiCard key={p.platform} label={`${p.platform} 세션`} value={p.count} />
        ))}
      </div>

      <Suspense fallback={<ChartsFallback />}>
        <OverviewCharts overview={overview} series={series} />
      </Suspense>
    </div>
  );
}
