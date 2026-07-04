/**
 * LiteChat 서버 진입점 (Bun 런타임)
 *
 * - REST API + WebSocket + 두 프론트엔드 정적 파일을 하나의 프로세스로 서빙한다.
 * - `export default { fetch, websocket }` 형태는 Bun.serve의 표준 진입 형식이다.
 */
import { createApp } from './app';
import { createDeps } from './deps';
import { serveFrontend } from './static';
import { websocket } from './ws/hub';

const deps = createDeps();
const app = createApp(deps);

// 위의 어떤 라우트에도 걸리지 않은 요청은 정적 파일로 처리한다 (SPA fallback 포함).
app.get('*', serveFrontend(deps));

console.log(`LiteChat server listening on :${deps.config.port}`);

export default {
  port: deps.config.port,
  fetch: app.fetch,
  // idleTimeout 60초: 클라이언트가 25초마다 앱 레벨 핑을 보내므로 살아있는 연결은
  // 유지되고, 정상 종료(pagehide) 없이 강제 종료된 소켓은 ~120초 기본값 대신
  // 60초 안에 정리된다 → 오프라인 인식이 빨라져 푸시 알림이 제때 발송된다.
  websocket: { ...websocket, idleTimeout: 60 },
};
