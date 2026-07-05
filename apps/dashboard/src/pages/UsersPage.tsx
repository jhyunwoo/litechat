/**
 * 사용자별 방문 횟수 — 로그인 사용자 기준 세션 수 내림차순
 */
import { useEffect, useState } from 'react';
import { adminApi, type UserVisit } from '../api';

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

  return (
    <div className="rounded-xl border border-hairline bg-card p-5">
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
  );
}
