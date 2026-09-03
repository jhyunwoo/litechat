/**
 * 개요 화면의 차트 영역 — recharts를 쓰는 부분만 따로 뗀 지연 로드 경계.
 *
 * recharts는 압축 후에도 85 KB(brotli)라 대시보드에서 가장 무거운 의존성이다.
 * 개요는 대시보드의 기본 라우트이므로, 이걸 진입 경로에 두면 KPI 숫자를 보기까지
 * 매번 recharts를 통째로 기다려야 한다. 차트만 잘라내면 KPI 카드가 먼저 그려지고
 * 차트는 뒤이어 채워진다 (자리 높이는 미리 잡아 두므로 레이아웃 이동은 없다).
 */
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
import type { Overview, TimeseriesPoint } from '../../api';
import { chart, tooltipLabelStyle, tooltipStyle } from '../../chart';

interface Props {
  overview: Overview | null;
  series: TimeseriesPoint[];
}

export default function OverviewCharts({ overview, series }: Props) {
  return (
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
  );
}
