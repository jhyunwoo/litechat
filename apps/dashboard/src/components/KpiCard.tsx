/**
 * KPI 카드 — 라벨 + 큰 숫자/문자열 값. Overview/Notifications 페이지가 공유한다.
 */
export function KpiCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-hairline bg-card p-5">
      <p className="text-sm text-ink-mute">{label}</p>
      <p className="tnum display mt-1 text-3xl">{value}</p>
    </div>
  );
}
