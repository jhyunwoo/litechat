/**
 * 사용자 분석 계측 — 서비스 개선을 위해 접속 환경(기기/위치 등)과 성능 지표를 수집한다.
 *
 * 방문자/세션 식별은 서버가 lc_vid/lc_sid 쿠키로 전담하므로(analytics/cookies.ts),
 * 여기서는 어떤 ID도 만들지 않고 그냥 요청만 보낸다. 수집 실패가 앱 사용을 막아서는
 * 안 되므로 모든 호출은 실패해도 조용히 무시한다(best-effort).
 */
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';
import { api } from './api';

// 첫 페이지뷰/웹바이탈이 세션 등록보다 먼저 도착하지 않도록 초기 요청을 공유한다.
// 세션 요청이 실패해도 후속 계측은 진행하며, 서버가 누락 세션을 복구한다.
let sessionReady: Promise<void> = Promise.resolve();

/** 앱 로드 시 1회 — 방문자 식별/기기 정보 등록만 담당한다 (페이지뷰는 별도) */
export function bootstrapAnalytics(): void {
  sessionReady = api.api.analytics.session
    .$post({ json: { platform: 'web', referrer: document.referrer || undefined } })
    .then(() => undefined)
    .catch(() => undefined);

  onCLS(sendVital);
  onFCP(sendVital);
  onINP(sendVital);
  onLCP(sendVital);
  onTTFB(sendVital);
}

/** SPA 라우트 전환마다 호출 — 최초 진입 경로도 포함해서 매번 보낸다 */
export function trackPageview(path: string): void {
  void sessionReady.then(() => api.api.analytics.event.$post({ json: { path } })).catch(() => {});
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
  // 언로드 직전에는 Promise 대기로 beacon 기회를 놓칠 수 있어 즉시 전송한다.
  // 부모 세션이 아직 없다면 서버가 같은 요청 정보로 먼저 복구한다.
  navigator.sendBeacon('/api/analytics/vitals', new Blob([body], { type: 'application/json' }));
}
