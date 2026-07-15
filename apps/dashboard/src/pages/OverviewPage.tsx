/**
 * 개요 — KPI 카드 + 방문/이벤트 시계열
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
import { adminApi, type Overview, type TimeseriesPoint } from '../api';
import { KpiCard } from '../components/KpiCard';

export default function OverviewPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [series, setSeries] = useState<TimeseriesPoint[]>([]);

  useEffect(() => {
    void adminApi.overview(30).then(setOverview);
    void adminApi.timeseries(30).then(setSeries);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="전체 세션 (30일)" value={overview?.sessions ?? '–'} />
        <KpiCard label="순 방문자 (30일)" value={overview?.visitors ?? '–'} />
        <KpiCard label="로그인 세션" value={overview?.loggedInSessions ?? '–'} />
        <KpiCard
          label="플랫폼"
          value={overview?.byPlatform.map((p) => `${p.platform} ${p.count}`).join(' · ') ?? '–'}
        />
      </div>

      <div className="rounded-xl border border-hairline bg-card p-5">
        <h2 className="mb-4 text-sm text-ink-mute">일별 방문/이벤트 추이 (30일)</h2>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={series} margin={{ left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#34366e" />
            <XAxis dataKey="day" stroke="#a3a6d1" fontSize={12} />
            <YAxis stroke="#a3a6d1" fontSize={12} allowDecimals={false} />
            <Tooltip
              contentStyle={{ background: '#24275f', border: '1px solid #34366e', borderRadius: 8 }}
              labelStyle={{ color: '#ffffff' }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="sessions"
              name="세션"
              stroke="#8b7bff"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="events"
              name="이벤트(페이지뷰)"
              stroke="#1f9d6e"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
