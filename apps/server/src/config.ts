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
  /** Full Chat 정적 파일 디렉터리 (빌드 산출물) */
  webStaticDir: string;
  /** Lite 정적 파일 디렉터리 (빌드 산출물) */
  liteStaticDir: string;
  /** Web Push VAPID 키 (비어 있으면 푸시 기능 비활성화) */
  vapidPublicKey: string;
  vapidPrivateKey: string;
  /** VAPID 연락처 (mailto: 또는 https URL) */
  vapidSubject: string;
  /** 프로덕션 여부 — 쿠키 Secure 속성 등에 사용 */
  isProduction: boolean;
  /** argon2id 메모리 비용 (KiB) — 테스트에서는 낮춰 빠르게 실행 */
  passwordMemoryCost: number;
  /** argon2id 반복 횟수 */
  passwordTimeCost: number;
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
    webStaticDir: env.WEB_STATIC_DIR ?? '../web/dist',
    liteStaticDir: env.LITE_STATIC_DIR ?? '../lite/dist',
    vapidPublicKey: env.VAPID_PUBLIC_KEY ?? '',
    vapidPrivateKey: env.VAPID_PRIVATE_KEY ?? '',
    vapidSubject: env.VAPID_SUBJECT ?? 'mailto:admin@moveto.kr',
    isProduction: env.NODE_ENV === 'production',
    passwordMemoryCost: Number(env.PASSWORD_MEMORY_COST ?? 65536),
    passwordTimeCost: Number(env.PASSWORD_TIME_COST ?? 2),
    ...overrides,
  };
}
