/**
 * litechat 서버 진입점 (Bun 런타임)
 *
 * - REST API + WebSocket + 두 프론트엔드 정적 파일을 하나의 프로세스로 서빙한다.
 * - `export default { fetch, websocket }` 형태는 Bun.serve의 표준 진입 형식이다.
 */
import { createApp } from './app';
import { startRetentionSchedule } from './db/retention';
import { createDeps } from './deps';
import { startGeoipAutoRefresh } from './modules/analytics/geoip-updater';
import { AnalyticsService } from './modules/analytics/service';
import { serveFrontend } from './static';
import { websocket } from './ws/hub';

const deps = createDeps();
// 부팅 정리(createApp) 이후에도 장기 실행 중 6시간마다 보관기간을 강제한다.
startRetentionSchedule(deps.db);
// GeoLite2 DB 주간 자동 갱신 — 부팅 시 + 6시간마다 파일 나이를 확인해 7일 지나면 교체한다.
startGeoipAutoRefresh(deps.config);
// static.ts의 lite 서버사이드 수집 훅과 /api/analytics, /api/admin 라우트가 같은 인스턴스를 공유한다.
const analyticsService = new AnalyticsService(deps);
const app = createApp(deps, { analyticsService });

// 위의 어떤 라우트에도 걸리지 않은 요청은 정적 파일로 처리한다 (SPA fallback 포함).
app.get('*', serveFrontend(deps, analyticsService));

console.log(`litechat server listening on :${deps.config.port}`);

export default {
  port: deps.config.port,
  fetch: app.fetch,
  // idleTimeout 60초: 클라이언트가 25초마다 앱 레벨 핑을 보내므로 살아있는 연결은
  // 유지되고, 정상 종료(pagehide) 없이 강제 종료된 소켓은 ~120초 기본값 대신
  // 60초 안에 정리된다 → 오프라인 인식이 빨라져 푸시 알림이 제때 발송된다.
  websocket: { ...websocket, idleTimeout: 60 },
};
