/**
 * 웹 바이탈 — 지표별 일일 평균/p75 추이 (지표마다 단위가 달라 한 번에 하나씩만 그린다)
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

const METRICS = ['LCP', 'CLS', 'INP', 'FCP', 'TTFB'] as const;

export default function VitalsPage() {
  const [metric, setMetric] = useState<(typeof METRICS)[number]>('LCP');
  const [series, setSeries] = useState<VitalsPoint[]>([]);

  useEffect(() => {
    void adminApi.vitals(metric, 30).then(setSeries);
  }, [metric]);

  return (
    <div className="rounded-xl border border-hairline bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm text-ink-mute">웹 바이탈 추이 (30일, web만 해당)</h2>
        <div className="flex gap-1">
          {METRICS.map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`rounded-full px-3 py-1 text-xs transition-colors ${
                m === metric ? 'bg-primary text-white' : 'text-ink-mute hover:text-white'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={series} margin={{ left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#34366e" />
          <XAxis dataKey="day" stroke="#a3a6d1" fontSize={12} />
          <YAxis stroke="#a3a6d1" fontSize={12} />
          <Tooltip
            contentStyle={{ background: '#24275f', border: '1px solid #34366e', borderRadius: 8 }}
            labelStyle={{ color: '#ffffff' }}
          />
          <Legend />
          <Line type="monotone" dataKey="avg" name="평균" stroke="#8b7bff" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="p75" name="p75" stroke="#1f9d6e" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
      {series.length === 0 && <p className="py-8 text-center text-ink-mute">데이터가 없어요.</p>}
    </div>
  );
}
