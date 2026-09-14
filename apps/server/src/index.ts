/**
 * litechat 서버 진입점 (Bun 런타임)
 *
 * - REST API + WebSocket + 세 프론트엔드 정적 파일을 하나의 프로세스로 서빙한다.
 * - Bun.serve로 직접 띄운다 — 반환된 Server 핸들이 있어야 SIGTERM에서
 *   진행 중인 요청을 흘려보내고 깨끗하게 종료할 수 있다.
 */
import { WatchPushService } from './modules/watch/push';
import { createApp } from './app';
import { startCheckpointSchedule } from './db/database';
import { startRetentionSchedule } from './db/retention';
import { createDeps } from './deps';
import { startGeoipAutoRefresh } from './modules/analytics/geoip-updater';
import { AnalyticsService } from './modules/analytics/service';
import { serveFrontend } from './static';
import { websocket } from './ws/hub';

const deps = createDeps();
// 부팅 정리(createApp) 이후에도 장기 실행 중 6시간마다 보관기간을 강제한다.
const stopRetention = startRetentionSchedule(deps.db);
// WAL 체크포인트 — synchronous=NORMAL의 데이터 유실 창을 60초로 묶는다 (database.ts 참고).
const stopCheckpoints = startCheckpointSchedule(deps.db);
// GeoLite2 DB 주간 자동 갱신 — 부팅 시 + 6시간마다 파일 나이를 확인해 7일 지나면 교체한다.
startGeoipAutoRefresh(deps.config);
// static.ts의 lite 서버사이드 수집 훅과 /api/analytics, /api/admin 라우트가 같은 인스턴스를 공유한다.
const analyticsService = new AnalyticsService(deps);
const watchPushService = new WatchPushService(deps);
const app = createApp(deps, { analyticsService, watchPushService });
const stopWatchPush = watchPushService.start();

// 위의 어떤 라우트에도 걸리지 않은 요청은 정적 파일로 처리한다 (SPA fallback 포함).
app.get('*', serveFrontend(deps, analyticsService));

const server = Bun.serve({
  port: deps.config.port,
  maxRequestBodySize: 11 * 1024 * 1024,
  idleTimeout: 40, // Bounded Watch polls may wait 25 seconds before writing a response.
  fetch: app.fetch,
  // idleTimeout 60초: 클라이언트가 25초마다 앱 레벨 핑을 보내므로 살아있는 연결은
  // 유지되고, 정상 종료(pagehide) 없이 강제 종료된 소켓은 ~120초 기본값 대신
  // 60초 안에 정리된다 → 오프라인 인식이 빨라져 푸시 알림이 제때 발송된다.
  websocket: { ...websocket, idleTimeout: 60, maxPayloadLength: 8192 },
});

console.log(`litechat server listening on :${server.port}`);

/**
 * 우아한 종료 (Dokploy 재배포 = SIGTERM).
 *
 * 순서가 중요하다:
 *  1. 새 연결 수락 중단 + 진행 중인 HTTP 요청은 끝까지 처리 (server.stop(false))
 *     — 업로드/이미지 변환 중인 요청이 중간에 끊기지 않는다.
 *  2. WebSocket을 1001로 명시적으로 닫아 클라이언트가 곧바로 재연결 루프에 들어가게 한다.
 *  3. WAL을 본 파일로 합치고 DB/Redis를 닫는다.
 * 유예 시간을 넘기면 그대로 종료한다 — 배포가 필요 이상으로 늘어지지 않게 한다.
 */
const SHUTDOWN_GRACE_MS = 10_000;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received — draining (${deps.hub.socketCount} websocket(s) open)`);

  stopRetention();
  stopCheckpoints();
  deps.hub.closeAll();
  deps.watchWaiters.close();
  await stopWatchPush();

  const drained = server.stop(false);
  const timeout = new Promise((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS));
  await Promise.race([Promise.resolve(drained), timeout]);

  try {
    // TRUNCATE 체크포인트로 WAL을 비워 다음 부팅이 복구 작업 없이 곧바로 뜨게 한다.
    deps.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    deps.db.close();
  } catch (error) {
    console.error('database shutdown failed:', error);
  }
  await deps.kv.close().catch(() => {});

  console.log('shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
