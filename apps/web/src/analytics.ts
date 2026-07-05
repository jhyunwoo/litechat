/**
 * 사용자 분석 계측 — 서비스 개선을 위해 접속 환경(기기/위치 등)과 성능 지표를 수집한다.
 *
 * 방문자/세션 식별은 서버가 lc_vid/lc_sid 쿠키로 전담하므로(analytics/cookies.ts),
 * 여기서는 어떤 ID도 만들지 않고 그냥 요청만 보낸다. 수집 실패가 앱 사용을 막아서는
 * 안 되므로 모든 호출은 실패해도 조용히 무시한다(best-effort).
 */
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';
import { api } from './api';

/** 앱 로드 시 1회 — 방문자 식별/기기 정보 등록만 담당한다 (페이지뷰는 별도) */
export function bootstrapAnalytics(): void {
  void api.api.analytics.session
    .$post({ json: { platform: 'web', referrer: document.referrer || undefined } })
    .catch(() => {});

  onCLS(sendVital);
  onFCP(sendVital);
  onINP(sendVital);
  onLCP(sendVital);
  onTTFB(sendVital);
}

/** SPA 라우트 전환마다 호출 — 최초 진입 경로도 포함해서 매번 보낸다 */
export function trackPageview(path: string): void {
  void api.api.analytics.event.$post({ json: { path } }).catch(() => {});
}

/**
 * 페이지 언로드 중에도 유실 없이 전송되도록 sendBeacon을 쓴다
 * (fetch는 페이지가 닫히는 순간 취소될 수 있다).
 */
function sendVital(metric: Metric): void {
  const body = JSON.stringify({
    metric: metric.name,
    value: metric.value,
    path: location.pathname,
  });
  navigator.sendBeacon('/api/analytics/vitals', new Blob([body], { type: 'application/json' }));
}
