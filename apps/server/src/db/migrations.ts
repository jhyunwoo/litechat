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
];
