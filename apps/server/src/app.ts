/**
 * Hono 애플리케이션 조립
 *
 * 모든 API 모듈을 `/api` 아래에 마운트하고, 전체 라우트 체인의 타입을
 * `AppType`으로 내보낸다. Full Chat 클라이언트는 `hc<AppType>`으로
 * 타입 안전한 RPC 호출을 한다 (Hono Stack).
 */
import { Hono } from 'hono';
import type { AppDeps } from './deps';
import { attachDocs } from './docs';
import { ApiError } from './errors';
import { adminRoutes } from './modules/admin/routes';
import { analyticsRoutes } from './modules/analytics/routes';
import { AnalyticsService } from './modules/analytics/service';
import { authRoutes } from './modules/auth/routes';
import { chatRoutes } from './modules/chat/routes';
import { ChatService } from './modules/chat/service';
import { friendsRoutes } from './modules/friends/routes';
import { imagesRoutes, imgRoutes } from './modules/images/routes';
import { ImagesService } from './modules/images/service';
import { ExpoPushService, type ExpoPushSender } from './modules/push/expo-service';
import { NotificationLogRepo } from './modules/push/notification-log-repo';
import { pushRoutes } from './modules/push/routes';
import { PushService, type PushSender } from './modules/push/service';
import { safetyRoutes } from './modules/safety/routes';
import { wsRoutes } from './ws/routes';
import { secureHeaders } from 'hono/secure-headers';
import { applyRetention } from './db/retention';

/** 라우트 핸들러에서 사용할 수 있는 컨텍스트 변수 타입 */
export interface AppVariables {
  /** 인증 미들웨어가 채우는 현재 사용자 ID */
  userId: number;
}

export type AppEnv = { Variables: AppVariables };

/** createApp 옵션 — 테스트에서 외부 의존(푸시 발송)을 대체하거나, index.ts가 static.ts와
 * 공유할 AnalyticsService 인스턴스를 주입할 때 사용 */
export interface CreateAppOptions {
  pushSender?: PushSender;
  expoPushSender?: ExpoPushSender;
  analyticsService?: AnalyticsService;
}

/** 의존성을 주입받아 Hono 앱을 조립한다. */
export function createApp(deps: AppDeps, options: CreateAppOptions = {}) {
  applyRetention(deps.db);
  // 상대가 오프라인일 때 푸시를 쏘는 훅을 ChatService에 주입한다.
  // Web Push(브라우저/PWA)와 Expo Push(네이티브 앱)를 하나의 훅으로 합성한다.
  const notificationLogRepo = new NotificationLogRepo(deps.db);
  const pushService = new PushService(deps, notificationLogRepo, options.pushSender);
  const expoPushService = new ExpoPushService(deps, notificationLogRepo, options.expoPushSender);
  const offlineHook: typeof pushService.offlineHook = (peerId, sender, message) => {
    pushService.offlineHook(peerId, sender, message);
    expoPushService.offlineHook(peerId, sender, message);
  };
  // ChatService는 REST와 WS 라우트가 공유한다.
  const chatService = new ChatService(deps, offlineHook);
  const imagesService = new ImagesService(deps);
  // static.ts의 lite 서버사이드 수집 훅과 같은 인스턴스를 쓰도록 index.ts가 주입할 수 있다.
  const analyticsService = options.analyticsService ?? new AnalyticsService(deps);

  const app = new Hono<AppEnv>()
    .use(
      '*',
      secureHeaders({
        /**
         * hono의 secureHeaders()는 기본적으로 CSP를 넣지 않는다. 세 프론트엔드가
         * 모두 번들된 자기 오리진 스크립트만 쓰므로 script-src를 'self'로 좁힌다
         * (인라인 스크립트 없음 — Vite는 외부 파일로 뽑아낸다).
         *
         *  - connect-src: 같은 오리진 REST + 같은 오리진 WebSocket
         *  - img-src: 업로드 이미지(/img)와 data: (아이콘/캔버스 미리보기)
         *  - frame-ancestors 'none': 클릭재킹 차단 (X-Frame-Options의 최신 대체)
         *  - 대시보드 지도는 Google Maps JS를 CDN에서 받으므로 해당 오리진만 허용한다.
         */
        contentSecurityPolicy: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            'https://maps.googleapis.com',
            'https://maps.gstatic.com',
            // /docs(Scalar)는 CDN 스크립트를 쓴다. 문서를 실제로 노출할 때만 허용한다
            // — 프로덕션 기본값(exposeApiDocs=false)에서는 이 오리진이 빠진다.
            ...(deps.config.exposeApiDocs ? ['https://cdn.jsdelivr.net'] : []),
          ],
          // Tailwind가 런타임에 style 속성을 쓰므로 'unsafe-inline'이 필요하다.
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https://maps.googleapis.com', 'https://maps.gstatic.com'],
          connectSrc: ["'self'", 'https://maps.googleapis.com'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      }),
    )
    // 헬스체크 — 배포 환경(Dokploy)의 컨테이너 상태 확인용
    .get('/api/health', (c) => c.json({ ok: true }))
    .route('/api/auth', authRoutes(deps))
    .route('/api/friends', friendsRoutes(deps))
    .route('/api/chat', chatRoutes(deps, chatService))
    .route('/api/images', imagesRoutes(deps, imagesService))
    .route('/api/push', pushRoutes(deps, pushService, expoPushService, notificationLogRepo))
    .route('/api/safety', safetyRoutes(deps))
    .route('/api/analytics', analyticsRoutes(deps, analyticsService))
    .route('/api/admin', adminRoutes(deps, analyticsService, notificationLogRepo))
    .route('/img', imgRoutes(deps, imagesService))
    .route('/', wsRoutes(deps, chatService));

  // OpenAPI 명세(/openapi.json) + 문서 UI(/docs) — 모든 라우트 등록 후에 붙인다.
  if (deps.config.exposeApiDocs) attachDocs(app);

  // 서비스 계층에서 던진 ApiError를 일관된 JSON 오류 응답으로 변환한다.
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json({ error: error.code }, error.status);
    }
    console.error('Unhandled error:', error);
    return c.json({ error: 'INTERNAL' }, 500);
  });

  return app;
}

/** Hono RPC(hc)용 앱 타입 */
export type AppType = ReturnType<typeof createApp>;
