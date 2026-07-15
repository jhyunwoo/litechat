/**
 * GeoIP2 Insights 상세 카드 — 요약(ISP/조직/반경/캐시 여부) + 응답 전체 필드.
 * 글래스 패널 안에서 표시되므로 표면은 살짝 밝힌 흰 오버레이를 쓴다.
 */
import { useMemo } from 'react';
import type { InsightsResult } from '../../api';
import { formatDate } from './shared';

/**
 * Insights 원본 응답을 "키 경로 → 값" 목록으로 평탄화한다.
 * names 다국어 객체는 ko(없으면 en) 하나만 남겨 노이즈를 줄인다.
 */
function flattenInsights(value: unknown, prefix: string, out: [string, string][]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenInsights(item, `${prefix}[${index}]`, out));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'names' && child !== null && typeof child === 'object') {
        const names = child as Record<string, string>;
        out.push([
          prefix ? `${prefix}.name` : 'name',
          names.ko ?? names.en ?? Object.values(names)[0] ?? '',
        ]);
        continue;
      }
      flattenInsights(child, prefix ? `${prefix}.${key}` : key, out);
    }
  } else if (value !== undefined) {
    out.push([prefix, String(value)]);
  }
}

export function InsightsCard({ result }: { result: InsightsResult }) {
  const i = result.insights;
  // 저장된 원본 JSON 전문 → 모든 필드 (traits의 익명성 플래그, 대륙/등록 국가, 시간대 등 포함)
  const fields = useMemo(() => {
    try {
      const out: [string, string][] = [];
      flattenInsights(JSON.parse(i.data), '', out);
      return out;
    } catch {
      return [] as [string, string][];
    }
  }, [i.data]);
  return (
    <div className="mb-3 rounded-md border border-hairline/70 bg-white/5 px-4 py-3 text-xs">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm">Insights · {i.ip}</span>
        {result.cached && (
          <span className="rounded-full border border-hairline px-2 py-0.5 text-ink-mute">
            캐시됨 · {formatDate(i.fetchedAt)}
          </span>
        )}
        {result.stale && (
          <span className="rounded-full border border-danger/40 px-2 py-0.5 text-danger">
            오래된 캐시 (API 실패)
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
        <span>
          <span className="text-ink-mute">위치 </span>
          {[i.city, i.region, i.country].filter(Boolean).join(', ') || '—'}
        </span>
        <span>
          <span className="text-ink-mute">정확도 반경 </span>
          <span className="tnum">{i.accuracyRadius !== null ? `${i.accuracyRadius}km` : '—'}</span>
        </span>
        <span>
          <span className="text-ink-mute">사용자 유형 </span>
          {i.userType ?? '—'}
        </span>
        <span>
          <span className="text-ink-mute">ISP </span>
          {i.isp ?? '—'}
        </span>
        <span className="col-span-2">
          <span className="text-ink-mute">조직 </span>
          {i.organization ?? '—'}
        </span>
      </div>
      {fields.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer select-none text-ink-mute hover:text-white">
            전체 응답 필드 보기 ({fields.length})
          </summary>
          <div className="mt-2 grid gap-x-8 gap-y-0.5">
            {fields.map(([key, value], index) => (
              <div
                key={`${key}-${index}`}
                className="flex justify-between gap-3 border-b border-hairline/30 py-1"
              >
                <span className="shrink-0 text-ink-mute">{key}</span>
                <span className="tnum break-all text-right">{value}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
