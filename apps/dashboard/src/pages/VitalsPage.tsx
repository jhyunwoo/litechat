/**
 * 웹 바이탈 — 지표별 일일 평균/p75 추이.
 *
 * 지표마다 단위가 달라 축을 공유할 수 없으므로(듀얼축 금지) 스몰 멀티플로
 * 지표당 카드 하나씩 그린다 — 와이드 화면에서 5개 지표가 한눈에 들어온다.
 */
import { useEffect, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { adminApi, type VitalsPoint } from '../api';
import { chart, tooltipLabelStyle, tooltipStyle } from '../chart';

const METRICS = ['LCP', 'CLS', 'INP', 'FCP', 'TTFB'] as const;
type Metric = (typeof METRICS)[number];

function MetricCard({ metric, series }: { metric: Metric; series: VitalsPoint[] | undefined }) {
  return (
    <div className="rounded-xl border border-hairline bg-card p-5">
      <h2 className="mb-4 text-sm">
        <span className="display text-ink">{metric}</span>
        <span className="ml-2 text-ink-mute">일일 평균 · p75</span>
      </h2>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={series ?? []} margin={{ left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
          <XAxis dataKey="day" stroke={chart.axis} fontSize={12} />
          <YAxis stroke={chart.axis} fontSize={12} />
          <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} />
          <Legend />
          <Line
            type="monotone"
            dataKey="avg"
            name="평균"
            stroke={chart.series1}
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="p75"
            name="p75"
            stroke={chart.series2}
            strokeWidth={2}
            strokeDasharray={chart.series2Dash}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
      {(series?.length ?? 0) === 0 && (
        <p className="py-4 text-center text-ink-mute">데이터가 없어요.</p>
      )}
    </div>
  );
}

export default function VitalsPage() {
  const [data, setData] = useState<Partial<Record<Metric, VitalsPoint[]>>>({});

  useEffect(() => {
    // 지표별 축이 독립이라 병렬로 각각 불러온다 (건당 응답이 작아 부담 없음)
    for (const m of METRICS) {
      void adminApi.vitals(m, 30).then((s) => setData((d) => ({ ...d, [m]: s })));
    }
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm text-ink-mute">웹 바이탈 추이 (30일, web만 해당)</h2>
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {METRICS.map((m) => (
          <MetricCard key={m} metric={m} series={data[m]} />
        ))}
      </div>
    </div>
  );
}
