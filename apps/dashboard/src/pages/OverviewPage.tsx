/**
 * 개요 — KPI 카드 + 방문/이벤트 시계열 + 플랫폼 분포
 *
 * 와이드 화면 활용: KPI를 한 행(최대 6칸)으로 펼치고, 시계열(2/3)과
 * 플랫폼 막대(1/3)를 나란히 배치한다.
 */
import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { adminApi, type Overview, type TimeseriesPoint } from '../api';
import { chart, tooltipLabelStyle, tooltipStyle } from '../chart';
import { KpiCard } from '../components/KpiCard';

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

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-xl border border-hairline bg-card p-4 sm:p-5 xl:col-span-2">
          <h2 className="mb-4 text-sm text-ink-mute">일별 방문/이벤트 추이 (30일)</h2>
          {/* 모바일에서는 차트 높이를 줄여 스크롤 부담을 던다 */}
          <div className="h-64 sm:h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
              <XAxis dataKey="day" stroke={chart.axis} fontSize={12} />
              <YAxis stroke={chart.axis} fontSize={12} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} />
              <Legend />
              <Line
                type="monotone"
                dataKey="sessions"
                name="세션"
                stroke={chart.series1}
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="events"
                name="이벤트(페이지뷰)"
                stroke={chart.series2}
                strokeWidth={2}
                strokeDasharray={chart.series2Dash}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-hairline bg-card p-4 sm:p-5">
          <h2 className="mb-4 text-sm text-ink-mute">플랫폼별 세션 (30일)</h2>
          <div className="h-64 sm:h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={overview?.byPlatform ?? []} margin={{ left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
              <XAxis dataKey="platform" stroke={chart.axis} fontSize={12} />
              <YAxis stroke={chart.axis} fontSize={12} allowDecimals={false} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={tooltipLabelStyle}
                cursor={{ fill: 'rgba(255, 255, 255, 0.06)' }}
              />
              <Bar
                dataKey="count"
                name="세션"
                fill={chart.series1}
                radius={[4, 4, 0, 0]}
                maxBarSize={48}
              />
            </BarChart>
          </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
