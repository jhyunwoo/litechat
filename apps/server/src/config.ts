/**
 * 서버 설정 — 환경 변수에서 읽어 하나의 불변 객체로 만든다.
 *
 * 테스트에서는 `createConfig()`에 원하는 값을 넘겨 오버라이드할 수 있다.
 */

export interface AppConfig {
  /** HTTP 서버 포트 */
  port: number;
  /** SQLite 데이터베이스 파일 경로 (':memory:' 가능) */
  dbPath: string;
  /** 업로드된 이미지 원본/webp를 저장할 디렉터리 */
  uploadDir: string;
  /** Redis 접속 URL (테스트에서는 사용하지 않음) */
  redisUrl: string;
  /** 세션 쿠키 Domain 값 — 두 서브도메인이 공유하도록 '.moveto.kr' 형태. 비우면 host-only */
  cookieDomain: string;
  /** 세션 유효 기간 (초) — 슬라이딩 방식으로 연장된다 */
  sessionTtlSeconds: number;
  /** Full Chat 사이트 호스트명 (Host 헤더 라우팅용) */
  webHost: string;
  /** Lite 사이트 호스트명 (Host 헤더 라우팅용) */
  liteHost: string;
  /** Lite 사이트로 함께 라우팅할 추가 호스트명 */
  liteHostAliases: readonly string[];
  /** Full Chat 정적 파일 디렉터리 (빌드 산출물) */
  webStaticDir: string;
  /** Lite 정적 파일 디렉터리 (빌드 산출물) */
  liteStaticDir: string;
  /** Web Push VAPID 키 (비어 있으면 푸시 기능 비활성화) */
  vapidPublicKey: string;
  vapidPrivateKey: string;
  /** VAPID 연락처 (mailto: 또는 https URL) */
  vapidSubject: string;
  /** Expo Push API 액세스 토큰 (선택 — Expo 계정에서 push security를 켠 경우에만 필요) */
  expoPushAccessToken: string;
  /** 프로덕션 여부 — 쿠키 Secure 속성 등에 사용 */
  isProduction: boolean;
  /** 관리자 대시보드 사이트 호스트명 (Host 헤더 라우팅용) */
  dashboardHost: string;
  /** 관리자 대시보드 정적 파일 디렉터리 (빌드 산출물) */
  dashboardStaticDir: string;
  /** MaxMind GeoLite2-City.mmdb 경로 — 파일이 없으면 GeoIP 조회를 건너뛴다 */
  geoipDbPath: string;
  /** MaxMind 계정 ID — GeoLite2 주간 자동 갱신 + GeoIP2 Insights 조회에 사용 (비우면 비활성화) */
  maxmindAccountId: string;
  /** MaxMind 라이선스 키 */
  maxmindLicenseKey: string;
  /** 관리자 대시보드 지도에 쓰는 Google Maps JavaScript API 키 (비어 있으면 지도 비활성화) */
  googleMapsApiKey: string;
  /** Google Maps Map ID — AdvancedMarker 렌더링에 필요. 기본은 개발용 'DEMO_MAP_ID' */
  googleMapsMapId: string;
  /** argon2id 메모리 비용 (KiB) — 테스트에서는 낮춰 빠르게 실행 */
  passwordMemoryCost: number;
  /** argon2id 반복 횟수 */
  passwordTimeCost: number;
  /** 프로덕션에서 OpenAPI/UI를 공개할지 여부 (기본 비활성) */
  exposeApiDocs: boolean;
  /**
   * 앱 앞단의 신뢰할 수 있는 리버스 프록시 수 (기본 1 = Traefik/Dokploy).
   * 이 수만큼만 X-Forwarded-For를 오른쪽에서 세어 클라이언트 주소를 고른다.
   * 0이면 전달 헤더를 전혀 신뢰하지 않는다(앱을 직접 노출한 경우).
   */
  trustedProxyHops: number;
  /** Cloudflare가 실제 엣지일 때만 true — CF-Connecting-IP를 권위 있는 값으로 쓴다. */
  trustCfConnectingIp: boolean;
}

/** 환경 변수 + 부분 오버라이드로 설정 객체를 생성한다. */
export function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const env = process.env;
  return {
    port: Number(env.PORT ?? 3000),
    dbPath: env.DB_PATH ?? 'data/litechat.db',
    uploadDir: env.UPLOAD_DIR ?? 'data/uploads',
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
    cookieDomain: env.COOKIE_DOMAIN ?? '',
    sessionTtlSeconds: Number(env.SESSION_TTL_SECONDS ?? 60 * 60 * 24 * 30),
    webHost: env.WEB_HOST ?? 'chat.moveto.kr',
    liteHost: env.LITE_HOST ?? 'litechat.moveto.kr',
    liteHostAliases: (env.LITE_HOST_ALIASES ?? 'lc.moveto.kr')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean),
    webStaticDir: env.WEB_STATIC_DIR ?? '../web/dist',
    liteStaticDir: env.LITE_STATIC_DIR ?? '../lite/dist',
    vapidPublicKey: env.VAPID_PUBLIC_KEY ?? '',
    vapidPrivateKey: env.VAPID_PRIVATE_KEY ?? '',
    vapidSubject: env.VAPID_SUBJECT ?? 'mailto:admin@moveto.kr',
    expoPushAccessToken: env.EXPO_PUSH_ACCESS_TOKEN ?? '',
    isProduction: env.NODE_ENV === 'production',
    dashboardHost: env.DASHBOARD_HOST ?? 'dash.moveto.kr',
    dashboardStaticDir: env.DASHBOARD_STATIC_DIR ?? '../dashboard/dist',
    geoipDbPath: env.GEOIP_DB_PATH ?? 'data/GeoLite2-City.mmdb',
    maxmindAccountId: env.MAXMIND_USER_NUM ?? '',
    maxmindLicenseKey: env.MAXMIND_API_KEY ?? '',
    googleMapsApiKey: env.GOOGLE_MAPS_API_KEY ?? '',
    googleMapsMapId: env.GOOGLE_MAPS_MAP_ID ?? 'DEMO_MAP_ID',
    passwordMemoryCost: Number(env.PASSWORD_MEMORY_COST ?? 65536),
    passwordTimeCost: Number(env.PASSWORD_TIME_COST ?? 2),
    exposeApiDocs: env.EXPOSE_API_DOCS === 'true' || env.NODE_ENV !== 'production',
    trustedProxyHops: Number(env.TRUSTED_PROXY_HOPS ?? 1),
    trustCfConnectingIp: env.TRUST_CF_CONNECTING_IP === 'true',
    ...overrides,
  };
}
