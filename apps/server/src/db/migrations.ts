/**
 * 데이터베이스 마이그레이션 정의
 *
 * SQLite의 `PRAGMA user_version`을 버전 카운터로 사용한다.
 * 배열 인덱스 i의 SQL은 user_version이 i일 때 실행되고, 실행 후 i+1로 올라간다.
 * 이미 배포된 마이그레이션은 절대 수정하지 말고 새 항목을 추가할 것.
 */
export const MIGRATIONS: string[] = [
  // v0 → v1: 초기 스키마
  `
  -- 사용자 계정
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,          -- 로그인 아이디 (소문자/숫자/밑줄)
    password_hash TEXT    NOT NULL,                 -- argon2id 해시 (Bun.password)
    nickname      TEXT    NOT NULL,                 -- 표시 이름
    created_at    INTEGER NOT NULL                  -- unix epoch 초
  );

  -- 친구 관계: 요청(pending) 또는 수락(accepted). 거절은 행 삭제로 처리.
  CREATE TABLE friendships (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id INTEGER NOT NULL REFERENCES users(id),
    addressee_id INTEGER NOT NULL REFERENCES users(id),
    status       TEXT    NOT NULL CHECK (status IN ('pending', 'accepted')),
    created_at   INTEGER NOT NULL,
    CHECK (requester_id <> addressee_id)
  );
  -- 방향과 무관하게 한 쌍당 하나의 관계만 허용
  CREATE UNIQUE INDEX ux_friendships_pair
    ON friendships (MIN(requester_id, addressee_id), MAX(requester_id, addressee_id));
  CREATE INDEX ix_friendships_addressee ON friendships (addressee_id, status);

  -- 1:1 대화방 — 친구 요청 수락 시 생성. user_a < user_b 로 정규화.
  CREATE TABLE conversations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_a     INTEGER NOT NULL REFERENCES users(id),
    user_b     INTEGER NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL,
    CHECK (user_a < user_b),
    UNIQUE (user_a, user_b)
  );

  -- 메시지 — id가 전역 단조 증가하므로 읽음 워터마크 비교에 그대로 사용한다.
  CREATE TABLE messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id),
    sender_id       INTEGER NOT NULL REFERENCES users(id),
    kind            TEXT    NOT NULL CHECK (kind IN ('t', 'i', 'e')),
    content         TEXT    NOT NULL,               -- 텍스트/이모지 본문 또는 이미지 ID
    created_at      INTEGER NOT NULL
  );
  CREATE INDEX ix_messages_conversation ON messages (conversation_id, id);

  -- 읽음 워터마크 — 사용자별 대화별로 "여기까지 읽었다" 한 행만 유지한다.
  -- 메시지마다 읽음 행을 만들지 않으므로 쓰기량과 전송량이 최소화된다.
  CREATE TABLE message_reads (
    conversation_id      INTEGER NOT NULL REFERENCES conversations(id),
    user_id              INTEGER NOT NULL REFERENCES users(id),
    last_read_message_id INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (conversation_id, user_id)
  );

  -- 업로드 이미지 메타데이터 — 파일 본체는 디스크에 저장된다.
  CREATE TABLE images (
    id         TEXT    PRIMARY KEY,                 -- 랜덤 문자열 ID
    owner_id   INTEGER NOT NULL REFERENCES users(id),
    orig_path  TEXT    NOT NULL,                    -- 원본 파일 경로
    webp_path  TEXT    NOT NULL,                    -- 저화질 webp 경로
    orig_bytes INTEGER NOT NULL,
    webp_bytes INTEGER NOT NULL,
    width      INTEGER NOT NULL,                    -- webp 기준 가로
    height     INTEGER NOT NULL,                    -- webp 기준 세로
    created_at INTEGER NOT NULL
  );

  -- Web Push 구독 — 브라우저/기기당 하나의 endpoint
  CREATE TABLE push_subscriptions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    endpoint   TEXT    NOT NULL UNIQUE,
    p256dh     TEXT    NOT NULL,
    auth       TEXT    NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX ix_push_user ON push_subscriptions (user_id);
  `,

  // v1 → v2: Expo Push 토큰 (네이티브 앱)
  `
  -- Expo Push 토큰 — 네이티브 기기당 하나. 같은 토큰이 다시 오면 소유자를 갱신한다.
  CREATE TABLE expo_push_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    token      TEXT    NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX ix_expo_push_user ON expo_push_tokens (user_id);
  `,

  // v2 → v3: 사용자 분석(웹/lite/앱 방문·이벤트·웹바이탈) + 관리자 계정
  `
  -- 방문자 세션 — 로그인 여부와 무관하게 항상 존재한다. visitor_id는 로그인 전후를
  -- 아우르는 장기 상관관계 키(쿠키 또는 앱이 생성), user_id는 로그인 시에만 채워진다.
  CREATE TABLE analytics_sessions (
    id           TEXT    PRIMARY KEY,               -- UUID (lc_sid 쿠키 또는 앱이 생성)
    visitor_id   TEXT    NOT NULL,                   -- UUID (lc_vid 쿠키 또는 앱이 생성, 장기 보관)
    user_id      INTEGER REFERENCES users(id),        -- 로그인 전이면 NULL
    platform     TEXT    NOT NULL CHECK (platform IN ('web', 'lite', 'app')),
    ip           TEXT    NOT NULL,
    user_agent   TEXT    NOT NULL DEFAULT '',
    referrer     TEXT,
    geo_country  TEXT,
    geo_region   TEXT,
    geo_city     TEXT,
    geo_lat      REAL,
    geo_lon      REAL,
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );
  CREATE INDEX ix_analytics_sessions_user    ON analytics_sessions (user_id, created_at);
  CREATE INDEX ix_analytics_sessions_created ON analytics_sessions (created_at);
  CREATE INDEX ix_analytics_sessions_visitor ON analytics_sessions (visitor_id, created_at);
  -- 지도 표기용: 위경도가 있는 세션만 빠르게 나열
  CREATE INDEX ix_analytics_sessions_geo
    ON analytics_sessions (created_at) WHERE geo_lat IS NOT NULL;

  -- 페이지/화면 조회 이벤트 — 세션당 다건 (SPA 라우트 전환, 앱 화면/포그라운드 전환)
  CREATE TABLE analytics_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT    NOT NULL REFERENCES analytics_sessions(id),
    path       TEXT    NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX ix_analytics_events_session ON analytics_events (session_id, created_at);
  CREATE INDEX ix_analytics_events_created ON analytics_events (created_at);

  -- Web Vitals — web(Full Chat)만 해당. lite/app은 전송하지 않는다.
  CREATE TABLE analytics_vitals (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT    NOT NULL REFERENCES analytics_sessions(id),
    metric     TEXT    NOT NULL CHECK (metric IN ('LCP', 'CLS', 'INP', 'FCP', 'TTFB')),
    value      REAL    NOT NULL,
    path       TEXT    NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX ix_analytics_vitals_metric_created ON analytics_vitals (metric, created_at);

  -- 관리자 계정 — 채팅 users 테이블/세션과 완전히 분리된 별도 인증
  CREATE TABLE admin_users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,                   -- argon2id (Bun.password, users와 동일 방식)
    created_at    INTEGER NOT NULL
  );
  `,

  // v3 → v4: GeoIP2 Insights 결과 캐시 — 유료 API라 IP당 결과를 저장해 재사용한다
  `
  -- 같은 IP를 1주 안에 다시 조회하면 API를 부르지 않고 이 행을 그대로 쓴다 (fetched_at 기준).
  -- 자주 쓰는 필드는 컬럼으로 추출하고, 응답 전문은 data(JSON)에 보관해 추후 필드 추가에 대비한다.
  CREATE TABLE geoip_insights (
    ip              TEXT    PRIMARY KEY,
    fetched_at      INTEGER NOT NULL,               -- unix epoch 초
    lat             REAL,
    lon             REAL,
    accuracy_radius INTEGER,                        -- km 단위 (MaxMind 표준)
    city            TEXT,
    region          TEXT,
    country         TEXT,
    isp             TEXT,
    organization    TEXT,
    user_type       TEXT,
    data            TEXT    NOT NULL                -- 원본 JSON 응답 전문
  );
  `,

  // v4 → v5: Insights 상시 수집 대상 사용자 — 여기 등록된 사용자의 새 접속은
  // (1주 IP 캐시를 지키면서) GeoIP2 Insights를 자동으로 수집해 저장한다
  `
  CREATE TABLE insights_watch (
    user_id    INTEGER PRIMARY KEY,
    created_at INTEGER NOT NULL
  );
  `,

  // v5 → v6: 알림 발송/수신 로그 — 웹/앱 푸시가 실제로 나갔는지, 클라이언트가 받았는지 추적한다
  `
  -- 발송 시도 하나당 한 행. channel로 web/expo를 구분해 하나의 테이블로 통합한다
  -- (analytics_sessions가 platform 컬럼으로 web/lite/app을 통합하는 것과 같은 패턴).
  CREATE TABLE notification_log (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id            INTEGER NOT NULL REFERENCES users(id),   -- 수신자
    channel            TEXT    NOT NULL CHECK (channel IN ('web', 'expo')),
    conversation_id    INTEGER REFERENCES conversations(id),
    body_preview       TEXT    NOT NULL DEFAULT '',             -- previewOf() 결과 (디버깅용)
    sent_at            INTEGER NOT NULL,
    sent_status        TEXT    NOT NULL CHECK (sent_status IN ('ok', 'error', 'expired')),
    sent_error         TEXT,                                    -- 실패 사유 (nullable)
    -- Expo 전용: APNs 접수 확인(영수증). web은 확인 API가 없어 항상 NULL.
    receipt_status     TEXT    CHECK (receipt_status IN ('pending', 'ok', 'error')),
    receipt_checked_at INTEGER,
    expo_ticket_id     TEXT,                                    -- Expo 티켓 id (영수증 확인용 상관키)
    expo_token         TEXT,                                    -- 영수증이 DeviceNotRegistered일 때 토큰 정리용
    -- 클라이언트 ACK(서비스워커 push 핸들러 / addNotificationReceivedListener)가 채운다.
    -- 클라이언트 프로세스가 완전히 종료된 상태로 도착한 알림은 영영 NULL로 남는다(플랫폼 한계).
    received_at        INTEGER,
    received_meta      TEXT                                     -- ACK 요청의 User-Agent 등 (선택)
  );
  CREATE INDEX ix_notification_log_user ON notification_log (user_id, sent_at);
  CREATE INDEX ix_notification_log_sent ON notification_log (sent_at);
  `,

  // v6 → v7: GeoLite2의 위치 정확도 반경(km)을 세션에 저장 — 지도가 줌과 무관하게
  // 정확한 지리 반경(미터 기반 원)을 그릴 수 있게 한다. 기존 행은 NULL로 남는다.
  `
  ALTER TABLE analytics_sessions ADD COLUMN geo_accuracy_km REAL;
  `,

  // v7 → v8: UGC 안전 기능 — 사용자 차단과 실제 처리 가능한 신고 큐
  `
  CREATE TABLE user_blocks (
    blocker_id INTEGER NOT NULL REFERENCES users(id),
    blocked_id INTEGER NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
  );
  CREATE INDEX ix_user_blocks_blocked ON user_blocks (blocked_id, blocker_id);

  CREATE TABLE content_reports (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id      INTEGER NOT NULL REFERENCES users(id),
    reported_user_id INTEGER NOT NULL REFERENCES users(id),
    message_id       INTEGER REFERENCES messages(id),
    reason           TEXT NOT NULL CHECK (reason IN ('harassment','hate','sexual','violence','spam','other')),
    details          TEXT,
    status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','dismissed','actioned')),
    created_at       INTEGER NOT NULL,
    resolved_at      INTEGER,
    CHECK (reporter_id <> reported_user_id)
  );
  CREATE INDEX ix_content_reports_status ON content_reports (status, created_at);
  CREATE INDEX ix_content_reports_reported ON content_reports (reported_user_id, created_at);
  `,

  // v8 → v9: 실측으로 확인된 전체 테이블 스캔 3건을 없애는 인덱스
  //
  // EXPLAIN QUERY PLAN 근거 (사용자 400 / 대화 4,800 / 메시지 60,500 시드):
  //   images.canAccess   → SCAN messages  (p50 16.3 ms, p99 291 ms) — 이미지 썸네일을
  //                        **받는 쪽**이 볼 때마다 messages 전체를 훑었다. 비용이 전체
  //                        메시지 수에 비례해 영원히 증가하는 유일한 경로라 가장 시급했다.
  //   friends.listFriends / listOutgoing → SCAN friendships (친구 탭 로드마다)
  //   listConversations  → SCAN conversations (채팅 탭 로드마다)
  `
  -- 이미지 메시지 조회용 부분 인덱스. kind='i' 행만 담아 인덱스를 작게 유지하고,
  -- conversation_id를 함께 넣어 접근 제어 쿼리가 메시지 본체를 읽지 않게 한다(커버링).
  CREATE INDEX ix_messages_image_content
    ON messages (content, conversation_id) WHERE kind = 'i';

  -- friendships는 addressee 방향만 인덱스가 있었다. requester 방향을 추가하면
  -- (requester_id = ? OR addressee_id = ?) 를 MULTI-INDEX OR로 처리할 수 있다.
  CREATE INDEX ix_friendships_requester ON friendships (requester_id, status);

  -- conversations의 UNIQUE(user_a, user_b)는 user_a 방향만 커버한다. user_b 방향을
  -- 추가해 대화 목록 조회가 전체 스캔 대신 두 인덱스 탐색으로 끝나게 한다.
  CREATE INDEX ix_conversations_user_b ON conversations (user_b);
  `,

  // v9 → v10: 답장 — 메시지가 같은 대화 안의 다른 메시지를 인용한다.
  //
  // 인덱스를 만들지 않는 이유: 조회는 항상 PK(m.id IN (...))로만 일어나고
  // "이 메시지에 달린 답장 전부" 같은 역방향 질의가 없다. 실측 근거 없는 인덱스는
  // 메시지 삽입마다 쓰기 비용만 늘린다 — 이 프로젝트에서 가장 뜨거운 경로다.
  //
  // 매달린 참조가 생기지 않는 이유: 계정 삭제는 대화의 메시지를 통째로 지우고
  // (modules/auth/service.ts), 인용은 언제나 같은 대화 안이므로 대상만 사라지지 않는다.
  `
  ALTER TABLE messages ADD COLUMN reply_to_id INTEGER REFERENCES messages(id);
  `,
];
