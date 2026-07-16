/**
 * 사용자별 방문 횟수 — 로그인 사용자 기준 세션 수 내림차순.
 * 와이드 화면 활용: 왼쪽 전체 표 + 오른쪽 상위 10명 가로 막대 (같은 데이터 재사용).
 */
import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { adminApi, type UserVisit } from '../api';
import { chart, tooltipLabelStyle, tooltipStyle } from '../chart';

function formatDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default function UsersPage() {
  const [rows, setRows] = useState<UserVisit[]>([]);

  useEffect(() => {
    void adminApi.usersVisits().then(setRows);
  }, []);

  // 서버가 세션 수 내림차순으로 주므로 앞에서 10명만 자르면 상위 방문자다
  const top = rows.slice(0, 10);

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[1fr_420px]">
      <div className="rounded-xl border border-hairline bg-card p-4 sm:p-5">
        <h2 className="mb-4 text-sm text-ink-mute">사용자별 방문 횟수 ({rows.length}명)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-hairline text-ink-mute">
                <th className="py-2 pr-4 font-normal">닉네임</th>
                <th className="py-2 pr-4 font-normal">아이디</th>
                <th className="py-2 pr-4 font-normal">방문 횟수</th>
                <th className="py-2 pr-4 font-normal">마지막 접속</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.userId} className="border-b border-hairline/50">
                  <td className="py-2 pr-4">{row.nickname}</td>
                  <td className="py-2 pr-4 text-ink-mute">@{row.username}</td>
                  <td className="tnum py-2 pr-4">{row.sessionCount}</td>
                  <td className="tnum py-2 pr-4 text-ink-mute">{formatDate(row.lastSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="py-8 text-center text-ink-mute">데이터가 없어요.</p>}
        </div>
      </div>

      {top.length > 0 && (
        <div className="rounded-xl border border-hairline bg-card p-4 sm:p-5">
          <h2 className="mb-4 text-sm text-ink-mute">상위 방문자 (Top {top.length})</h2>
          <ResponsiveContainer width="100%" height={Math.max(220, top.length * 36)}>
            <BarChart data={top} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} horizontal={false} />
              <XAxis type="number" stroke={chart.axis} fontSize={12} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="nickname"
                stroke={chart.axis}
                fontSize={12}
                width={88}
                tickLine={false}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={tooltipLabelStyle}
                cursor={{ fill: 'rgba(255, 255, 255, 0.06)' }}
              />
              <Bar
                dataKey="sessionCount"
                name="방문 횟수"
                fill={chart.series1}
                radius={[0, 4, 4, 0]}
                maxBarSize={20}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
