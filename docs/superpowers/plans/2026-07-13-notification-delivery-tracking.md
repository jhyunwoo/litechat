# 알림 발송/수신 추적 + 대시보드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 웹(Web Push)/앱(Expo Push) 알림 발송을 영구 로그로 남기고, 클라이언트 ACK로 실제 수신 시각까지 기록해, 대시보드에서 수신자·송신 여부·수신 여부·송신 시각·수신 시각을 조회할 수 있게 한다.

**Architecture:** 새 테이블 `notification_log`(웹/앱 공통, `channel` 컬럼으로 구분)에 발송 시도마다 한 행을 남긴다. `PushService`/`ExpoPushService`가 발송 직전 INSERT하고 결과에 따라 상태를 UPDATE한다. 페이로드에 로그 id(`n`)를 실어 보내고, 클라이언트(서비스워커 `push` 핸들러 / Expo `addNotificationReceivedListener`)가 그 id로 `POST /api/push/ack`를 호출해 `received_at`을 채운다. Expo의 APNs 영수증 확인도 기존 인메모리 Map 대신 이 테이블에 영속화한다. 대시보드는 `/api/admin/notifications`(목록)와 `/api/admin/notifications/summary`(집계)를 새 페이지에서 필터/정렬/페이지네이션으로 조회한다.

**Tech Stack:** Bun + Hono + bun:sqlite (서버), React + Vite + Tailwind (대시보드), Expo SDK 57 + expo-notifications (앱), Web Push API + Workbox 서비스워커 (웹).

## Global Constraints

- 마이그레이션은 `apps/server/src/db/migrations.ts`의 `MIGRATIONS` 배열에 새 항목을 **추가만** 한다 — 기존 항목은 절대 수정하지 않는다 (현재 배열 길이 5 → 이번 작업은 인덱스 5, 즉 v5→v6).
- `bun:sqlite`는 `SELECT col AS camelCaseAlias`를 그대로 JS 객체 키로 반환한다 — 리포 계층에서 수동 매핑 불필요 (`apps/server/src/modules/analytics/repo.ts` 패턴).
- 정렬 컬럼은 항상 화이트리스트로 받는다 (`sort === 'x' ? 'x' : 'default'` 형태) — 사용자 입력을 SQL에 직접 보간하지 않는다.
- 대시보드는 `adminApi`(쿠키 기반, `credentials: 'include'`)를 통해서만 서버와 통신한다 — `apps/dashboard/src/api.ts` 기존 패턴을 따른다.
- 앱 클라이언트는 `apps/app/src/lib/api.ts`의 `hc<AppType>` 타입 안전 클라이언트를 쓴다. 웹 서비스워커(`sw.ts`)는 같은 오리진 raw `fetch`를 쓴다 (SW는 앱의 `api.ts`를 import하지 않는다).
- 실패한 발송 시도(웹 404/410, Expo error/DeviceNotRegistered)는 로그 행에 **반드시** 상태가 남아야 한다 — 조용히 버려지면 안 된다.

---

## Task 1: DB 마이그레이션 — `notification_log` 테이블

**Files:**
- Modify: `apps/server/src/db/migrations.ts`

**Interfaces:**
- Produces: `notification_log` 테이블 (컬럼: `id, user_id, channel, conversation_id, body_preview, sent_at, sent_status, sent_error, receipt_status, receipt_checked_at, expo_ticket_id, expo_token, received_at, received_meta`), 이후 모든 태스크가 이 스키마를 전제한다.

- [ ] **Step 1: `MIGRATIONS` 배열 끝에 새 마이그레이션 추가**

`apps/server/src/db/migrations.ts`의 배열 마지막(`insights_watch` 다음)에 추가:

```ts
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
```

- [ ] **Step 2: 마이그레이션이 깨끗이 적용되는지 확인**

Run: `cd apps/server && bun test src/db/database.test.ts`
Expected: PASS (기존 테스트가 `openTestDatabase()`로 전체 마이그레이션을 실행하므로, 여기서 실패하면 SQL 문법 오류다)

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/db/migrations.ts
git commit -m "feat(server): add notification_log table migration"
```

---

## Task 2: `pushAckSchema` 타입 추가

**Files:**
- Modify: `packages/types/src/schemas.ts`

**Interfaces:**
- Produces: `pushAckSchema` (zod), `PushAckInput` 타입 — Task 6(ack 라우트)이 사용.

- [ ] **Step 1: 스키마 추가**

`packages/types/src/schemas.ts`의 `expoPushUnregisterSchema` 바로 다음에 추가:

```ts
/**
 * 클라이언트 알림 수신 ACK — 서비스워커 push 핸들러 / Expo
 * addNotificationReceivedListener가 보낸다. n은 notification_log.id.
 */
export const pushAckSchema = z.object({
  n: z.number().int().positive(),
});
export type PushAckInput = z.infer<typeof pushAckSchema>;
```

- [ ] **Step 2: 타입 패키지 빌드 확인**

Run: `cd packages/types && bun run build 2>/dev/null || bunx tsc --noEmit`
Expected: 오류 없음 (이 패키지가 별도 빌드 스텝이 없다면 `tsc --noEmit`으로 타입 오류만 확인)

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/schemas.ts
git commit -m "feat(types): add pushAckSchema for notification receipt ACK"
```

---

## Task 3: `NotificationLogRepo` + 단위 테스트 (TDD)

**Files:**
- Create: `apps/server/src/modules/push/notification-log-repo.ts`
- Test: `apps/server/src/modules/push/notification-log-repo.test.ts`

**Interfaces:**
- Consumes: `notification_log` 테이블 (Task 1).
- Produces: `NotificationLogRepo` 클래스 — `insert(input): number`, `markFailed(id, status, error): void`, `markTicketPending(id, expoTicketId, expoToken): void`, `listPendingExpoReceipts(olderThanMs): {id, expoTicketId, expoToken}[]`, `updateReceiptStatus(id, status): void`, `markReceiptDeviceGone(id): void`, `markReceived(id, userId, meta): void`, `list(filter): {rows, total}`, `summary(days): NotificationSummary`. 타입: `NotificationChannel`, `SentStatus`, `ReceiptStatus`, `ReceivedStatus`, `NewNotificationLogInput`, `NotificationLogFilter`, `NotificationLogRow`, `NotificationSummary`. Task 4/5(PushService/ExpoPushService)와 Task 7(admin 라우트)이 이 클래스를 그대로 사용한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/server/src/modules/push/notification-log-repo.test.ts` 생성:

```ts
/**
 * NotificationLogRepo 단위 테스트 — 필터/정렬/집계 로직
 */
import { describe, expect, test } from 'bun:test';
import { openTestDatabase } from '../../db/database';
import { NotificationLogRepo } from './notification-log-repo';

function seedUsers(db: ReturnType<typeof openTestDatabase>) {
  db.exec(
    `INSERT INTO users (username, password_hash, nickname, created_at)
     VALUES ('alice', 'h', 'Alice', 0), ('bob', 'h', 'Bob', 0)`,
  );
}

describe('insert + markFailed', () => {
  test('삽입 직후 sentStatus는 ok, receivedStatus는 pending', () => {
    const db = openTestDatabase();
    seedUsers(db);
    const repo = new NotificationLogRepo(db);
    const id = repo.insert({ userId: 1, channel: 'web', conversationId: null, bodyPreview: 'hi' });
    const { rows } = repo.list({ sort: 'sent_at', dir: 'desc', limit: 10, offset: 0 });
    expect(rows[0]).toMatchObject({ id, sentStatus: 'ok', receivedAt: null, receivedStatus: 'pending' });
  });

  test('markFailed 후 sentStatus/sentError가 반영되고 receivedStatus는 n-a', () => {
    const db = openTestDatabase();
    seedUsers(db);
    const repo = new NotificationLogRepo(db);
    const id = repo.insert({ userId: 1, channel: 'web', conversationId: null, bodyPreview: 'hi' });
    repo.markFailed(id, 'expired', 'gone (410)');
    const { rows } = repo.list({ sort: 'sent_at', dir: 'desc', limit: 10, offset: 0 });
    expect(rows[0]).toMatchObject({ sentStatus: 'expired', sentError: 'gone (410)', receivedStatus: 'n-a' });
  });
});

describe('markReceived', () => {
  test('본인 로그만, 최초 1회만 받은 시각을 기록한다', () => {
    const db = openTestDatabase();
    seedUsers(db);
    const repo = new NotificationLogRepo(db);
    const id = repo.insert({ userId: 1, channel: 'web', conversationId: null, bodyPreview: 'hi' });

    repo.markReceived(id, 2, null); // 남의 로그 — 무시됨
    expect(repo.list({ sort: 'sent_at', dir: 'desc', limit: 10, offset: 0 }).rows[0]!.receivedAt).toBeNull();

    repo.markReceived(id, 1, 'UA-1');
    const first = repo.list({ sort: 'sent_at', dir: 'desc', limit: 10, offset: 0 }).rows[0]!;
    expect(first.receivedAt).not.toBeNull();
    expect(first.receivedStatus).toBe('received');

    const firstReceivedAt = first.receivedAt;
    repo.markReceived(id, 1, 'UA-2'); // 중복 ACK — 최초 시각 유지
    expect(repo.list({ sort: 'sent_at', dir: 'desc', limit: 10, offset: 0 }).rows[0]!.receivedAt).toBe(
      firstReceivedAt,
    );
  });
});

describe('list — 필터/정렬', () => {
  test('userId/channel/sentStatus/기간 필터', () => {
    const db = openTestDatabase();
    seedUsers(db);
    const repo = new NotificationLogRepo(db);
    const now = Math.floor(Date.now() / 1000);
    repo.insert({ userId: 1, channel: 'web', conversationId: null, bodyPreview: 'a' });
    repo.insert({ userId: 1, channel: 'expo', conversationId: null, bodyPreview: 'b' });
    const id3 = repo.insert({ userId: 2, channel: 'web', conversationId: null, bodyPreview: 'c' });
    repo.markFailed(id3, 'error', 'boom');

    expect(repo.list({ userId: 1, sort: 'sent_at', dir: 'desc', limit: 10, offset: 0 }).total).toBe(2);
    expect(repo.list({ channel: 'expo', sort: 'sent_at', dir: 'desc', limit: 10, offset: 0 }).total).toBe(1);
    expect(repo.list({ sentStatus: 'error', sort: 'sent_at', dir: 'desc', limit: 10, offset: 0 }).total).toBe(1);
    expect(repo.list({ from: now + 100, sort: 'sent_at', dir: 'desc', limit: 10, offset: 0 }).total).toBe(0);
  });

  test('receivedStatus 계산: n-a/received/pending/presumed_lost', () => {
    const db = openTestDatabase();
    seedUsers(db);
    const repo = new NotificationLogRepo(db);

    const failedId = repo.insert({ userId: 1, channel: 'web', conversationId: null, bodyPreview: 'x' });
    repo.markFailed(failedId, 'error', 'boom');

    const receivedId = repo.insert({ userId: 1, channel: 'web', conversationId: null, bodyPreview: 'x' });
    repo.markReceived(receivedId, 1, null);

    const pendingId = repo.insert({ userId: 1, channel: 'web', conversationId: null, bodyPreview: 'x' });

    const oldId = repo.insert({ userId: 1, channel: 'web', conversationId: null, bodyPreview: 'x' });
    db.query('UPDATE notification_log SET sent_at = ? WHERE id = ?').run(
      Math.floor(Date.now() / 1000) - 25 * 3600,
      oldId,
    );

    const byId = new Map(
      repo.list({ sort: 'sent_at', dir: 'desc', limit: 10, offset: 0 }).rows.map((r) => [r.id, r]),
    );
    expect(byId.get(failedId)!.receivedStatus).toBe('n-a');
    expect(byId.get(receivedId)!.receivedStatus).toBe('received');
    expect(byId.get(pendingId)!.receivedStatus).toBe('pending');
    expect(byId.get(oldId)!.receivedStatus).toBe('presumed_lost');
  });

  test('receivedStatus로 필터링', () => {
    const db = openTestDatabase();
    seedUsers(db);
    const repo = new NotificationLogRepo(db);
    const receivedId = repo.insert({ userId: 1, channel: 'web', conversationId: null, bodyPreview: 'x' });
    repo.markReceived(receivedId, 1, null);
    repo.insert({ userId: 1, channel: 'web', conversationId: null, bodyPreview: 'y' }); // pending

    expect(
      repo.list({ receivedStatus: 'received', sort: 'sent_at', dir: 'desc', limit: 10, offset: 0 }).total,
    ).toBe(1);
    expect(
      repo.list({ receivedStatus: 'pending', sort: 'sent_at', dir: 'desc', limit: 10, offset: 0 }).total,
    ).toBe(1);
  });

  test('페이지네이션', () => {
    const db = openTestDatabase();
    seedUsers(db);
    const repo = new NotificationLogRepo(db);
    for (let i = 0; i < 5; i += 1) {
      repo.insert({ userId: 1, channel: 'web', conversationId: null, bodyPreview: `${i}` });
    }
    const page1 = repo.list({ sort: 'sent_at', dir: 'asc', limit: 2, offset: 0 });
    const page2 = repo.list({ sort: 'sent_at', dir: 'asc', limit: 2, offset: 2 });
    expect(page1.rows.map((r) => r.bodyPreview)).toEqual(['0', '1']);
    expect(page2.rows.map((r) => r.bodyPreview)).toEqual(['2', '3']);
    expect(page1.total).toBe(5);
  });
});

describe('summary', () => {
  test('상태별 건수, 수신확인율, 평균 지연', () => {
    const db = openTestDatabase();
    seedUsers(db);
    const repo = new NotificationLogRepo(db);

    const okReceived = repo.insert({ userId: 1, channel: 'web', conversationId: null, bodyPreview: 'a' });
    repo.markReceived(okReceived, 1, null);
    repo.insert({ userId: 1, channel: 'web', conversationId: null, bodyPreview: 'b' }); // ok, 미수신
    const failed = repo.insert({ userId: 1, channel: 'web', conversationId: null, bodyPreview: 'c' });
    repo.markFailed(failed, 'error', 'boom');

    const summary = repo.summary(30);
    expect(summary.totalSent).toBe(3);
    expect(summary.byStatus).toEqual(
      expect.arrayContaining([
        { status: 'ok', count: 2 },
        { status: 'error', count: 1 },
      ]),
    );
    expect(summary.receivedCount).toBe(1);
    expect(summary.receivedRate).toBeCloseTo(0.5); // ok 2건 중 1건 수신
  });
});

describe('Expo 영수증 상관관계', () => {
  test('markTicketPending → listPendingExpoReceipts → updateReceiptStatus', () => {
    const db = openTestDatabase();
    seedUsers(db);
    const repo = new NotificationLogRepo(db);
    const id = repo.insert({ userId: 1, channel: 'expo', conversationId: null, bodyPreview: 'x' });
    repo.markTicketPending(id, 'ticket-1', 'ExponentPushToken[a]');

    // 아직 15분이 지나지 않아 대상이 아니다.
    expect(repo.listPendingExpoReceipts(15 * 60 * 1000)).toEqual([]);

    // 강제로 오래된 것처럼 만든다.
    db.query('UPDATE notification_log SET sent_at = ? WHERE id = ?').run(
      Math.floor(Date.now() / 1000) - 20 * 60,
      id,
    );
    const due = repo.listPendingExpoReceipts(15 * 60 * 1000);
    expect(due).toEqual([{ id, expoTicketId: 'ticket-1', expoToken: 'ExponentPushToken[a]' }]);

    repo.updateReceiptStatus(id, 'ok');
    const row = repo.list({ sort: 'sent_at', dir: 'desc', limit: 10, offset: 0 }).rows[0]!;
    expect(row.receiptStatus).toBe('ok');
    expect(row.receiptCheckedAt).not.toBeNull();
  });

  test('markReceiptDeviceGone은 sentStatus도 expired로 되돌린다', () => {
    const db = openTestDatabase();
    seedUsers(db);
    const repo = new NotificationLogRepo(db);
    const id = repo.insert({ userId: 1, channel: 'expo', conversationId: null, bodyPreview: 'x' });
    repo.markTicketPending(id, 'ticket-1', 'ExponentPushToken[a]');
    repo.markReceiptDeviceGone(id);
    const row = repo.list({ sort: 'sent_at', dir: 'desc', limit: 10, offset: 0 }).rows[0]!;
    expect(row.sentStatus).toBe('expired');
    expect(row.receiptStatus).toBe('error');
    expect(row.receivedStatus).toBe('n-a');
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `cd apps/server && bun test src/modules/push/notification-log-repo.test.ts`
Expected: FAIL — `Cannot find module './notification-log-repo'`

- [ ] **Step 3: `NotificationLogRepo` 구현**

`apps/server/src/modules/push/notification-log-repo.ts` 생성:

```ts
/**
 * notification_log 테이블 저장소 — 웹/앱 푸시 발송·수신 기록.
 *
 * 채널(web/expo)을 하나의 테이블로 통합한다 (analytics_sessions가 platform으로
 * web/lite/app을 통합하는 것과 같은 패턴) — 대시보드에서 사용자별 통합 조회가 쉽다.
 */
import type { Database } from 'bun:sqlite';

export type NotificationChannel = 'web' | 'expo';
export type SentStatus = 'ok' | 'error' | 'expired';
export type ReceiptStatus = 'pending' | 'ok' | 'error';
export type ReceivedStatus = 'received' | 'pending' | 'presumed_lost' | 'n-a';

/** 발송 후 이 시간이 지나도 ACK가 없으면 "미수신 추정"으로 표시한다 */
const PRESUMED_LOST_AFTER_SECONDS = 24 * 60 * 60;

export interface NewNotificationLogInput {
  userId: number;
  channel: NotificationChannel;
  conversationId: number | null;
  bodyPreview: string;
}

/** 조회 필터/정렬/페이지 — 정렬 컬럼은 화이트리스트로만 받는다 */
export interface NotificationLogFilter {
  userId?: number;
  channel?: NotificationChannel;
  sentStatus?: SentStatus;
  receivedStatus?: ReceivedStatus;
  /** unix epoch 초 범위 (sent_at 기준) */
  from?: number;
  to?: number;
  sort: 'sent_at' | 'received_at';
  dir: 'asc' | 'desc';
  limit: number;
  offset: number;
}

export interface NotificationLogRow {
  id: number;
  userId: number;
  username: string | null;
  nickname: string | null;
  channel: NotificationChannel;
  conversationId: number | null;
  bodyPreview: string;
  sentAt: number;
  sentStatus: SentStatus;
  sentError: string | null;
  receiptStatus: ReceiptStatus | null;
  receiptCheckedAt: number | null;
  receivedAt: number | null;
  receivedStatus: ReceivedStatus;
}

export interface NotificationSummary {
  totalSent: number;
  byStatus: { status: SentStatus; count: number }[];
  receivedCount: number;
  /** ok 상태 발송 건수 대비 수신 확인 비율 (0..1) */
  receivedRate: number;
  avgLatencySeconds: number | null;
}

/** receivedStatus 계산식 — SELECT 출력 컬럼과 WHERE 필터 양쪽에서 재사용한다.
 *  cutoff(파라미터 1개)를 소비하므로, 이 문자열을 SQL에 넣을 때마다 파라미터 배열에
 *  lostCutoff를 하나씩 짝지어 넣어야 한다. */
const RECEIVED_STATUS_CASE = `
  CASE
    WHEN nl.sent_status != 'ok' THEN 'n-a'
    WHEN nl.received_at IS NOT NULL THEN 'received'
    WHEN nl.sent_at > ? THEN 'pending'
    ELSE 'presumed_lost'
  END`;

export class NotificationLogRepo {
  constructor(private db: Database) {}

  /** 발송 시도 기록 — 항상 sent_status='ok'로 시작하고, 실패 시 markFailed로 되돌린다 */
  insert(input: NewNotificationLogInput): number {
    const now = Math.floor(Date.now() / 1000);
    const result = this.db
      .query(
        `INSERT INTO notification_log
           (user_id, channel, conversation_id, body_preview, sent_at, sent_status)
         VALUES (?, ?, ?, ?, ?, 'ok')`,
      )
      .run(input.userId, input.channel, input.conversationId, input.bodyPreview, now);
    return Number(result.lastInsertRowid);
  }

  markFailed(id: number, status: 'error' | 'expired', error: string): void {
    this.db
      .query('UPDATE notification_log SET sent_status = ?, sent_error = ? WHERE id = ?')
      .run(status, error, id);
  }

  /** Expo 티켓이 ok로 왔을 때 — 영수증 확인 대상으로 표시한다 (web은 호출하지 않음) */
  markTicketPending(id: number, expoTicketId: string, expoToken: string): void {
    this.db
      .query(
        `UPDATE notification_log
         SET expo_ticket_id = ?, expo_token = ?, receipt_status = 'pending'
         WHERE id = ?`,
      )
      .run(expoTicketId, expoToken, id);
  }

  /** olderThanMs 이상 지난 pending 영수증 대상 — Expo getReceipts API에 물어볼 목록 */
  listPendingExpoReceipts(olderThanMs: number): { id: number; expoTicketId: string; expoToken: string }[] {
    const cutoff = Math.floor((Date.now() - olderThanMs) / 1000);
    return this.db
      .query<{ id: number; expoTicketId: string; expoToken: string }, [number]>(
        `SELECT id, expo_ticket_id AS expoTicketId, expo_token AS expoToken
         FROM notification_log
         WHERE receipt_status = 'pending' AND expo_ticket_id IS NOT NULL AND sent_at <= ?`,
      )
      .all(cutoff);
  }

  updateReceiptStatus(id: number, status: 'ok' | 'error'): void {
    this.db
      .query('UPDATE notification_log SET receipt_status = ?, receipt_checked_at = ? WHERE id = ?')
      .run(status, Math.floor(Date.now() / 1000), id);
  }

  /** 영수증이 DeviceNotRegistered로 온 경우 — 발송 자체가 실패했던 것으로 되돌린다 */
  markReceiptDeviceGone(id: number): void {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .query(
        `UPDATE notification_log
         SET sent_status = 'expired', sent_error = 'DeviceNotRegistered (receipt)',
             receipt_status = 'error', receipt_checked_at = ?
         WHERE id = ?`,
      )
      .run(now, id);
  }

  /** 클라이언트 ACK — 본인 로그만, 최초 1회만 받은 시각을 기록한다 */
  markReceived(id: number, userId: number, meta: string | null): void {
    this.db
      .query(
        `UPDATE notification_log
         SET received_at = ?, received_meta = ?
         WHERE id = ? AND user_id = ? AND received_at IS NULL`,
      )
      .run(Math.floor(Date.now() / 1000), meta, id, userId);
  }

  list(filter: NotificationLogFilter): { rows: NotificationLogRow[]; total: number } {
    const lostCutoff = Math.floor(Date.now() / 1000) - PRESUMED_LOST_AFTER_SECONDS;

    const where: string[] = [];
    const whereParams: (string | number)[] = [];
    if (filter.userId !== undefined) {
      where.push('nl.user_id = ?');
      whereParams.push(filter.userId);
    }
    if (filter.channel) {
      where.push('nl.channel = ?');
      whereParams.push(filter.channel);
    }
    if (filter.sentStatus) {
      where.push('nl.sent_status = ?');
      whereParams.push(filter.sentStatus);
    }
    if (filter.from !== undefined) {
      where.push('nl.sent_at >= ?');
      whereParams.push(filter.from);
    }
    if (filter.to !== undefined) {
      where.push('nl.sent_at <= ?');
      whereParams.push(filter.to);
    }
    if (filter.receivedStatus) {
      where.push(`(${RECEIVED_STATUS_CASE}) = ?`);
      whereParams.push(lostCutoff, filter.receivedStatus);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total =
      this.db
        .query<{ n: number }, (string | number)[]>(
          `SELECT COUNT(*) AS n FROM notification_log nl ${whereSql}`,
        )
        .get(...whereParams)?.n ?? 0;

    const rows = this.db
      .query<NotificationLogRow, (string | number)[]>(
        `SELECT nl.id, nl.user_id AS userId, u.username, u.nickname,
                nl.channel, nl.conversation_id AS conversationId, nl.body_preview AS bodyPreview,
                nl.sent_at AS sentAt, nl.sent_status AS sentStatus, nl.sent_error AS sentError,
                nl.receipt_status AS receiptStatus, nl.receipt_checked_at AS receiptCheckedAt,
                nl.received_at AS receivedAt,
                ${RECEIVED_STATUS_CASE} AS receivedStatus
         FROM notification_log nl
         JOIN users u ON u.id = nl.user_id
         ${whereSql}
         ORDER BY nl.${filter.sort} ${filter.dir === 'asc' ? 'ASC' : 'DESC'}
         LIMIT ? OFFSET ?`,
      )
      .all(lostCutoff, ...whereParams, filter.limit, filter.offset);

    return { rows, total };
  }

  summary(days: number): NotificationSummary {
    const since = Math.floor(Date.now() / 1000) - days * 86400;

    const statusRows = this.db
      .query<{ sent_status: SentStatus; n: number }, [number]>(
        `SELECT sent_status, COUNT(*) AS n FROM notification_log WHERE sent_at >= ? GROUP BY sent_status`,
      )
      .all(since);
    const totalSent = statusRows.reduce((sum, r) => sum + r.n, 0);
    const okCount = statusRows.find((r) => r.sent_status === 'ok')?.n ?? 0;

    const received = this.db
      .query<{ n: number; avgLatency: number | null }, [number]>(
        `SELECT COUNT(*) AS n, AVG(received_at - sent_at) AS avgLatency
         FROM notification_log
         WHERE sent_at >= ? AND sent_status = 'ok' AND received_at IS NOT NULL`,
      )
      .get(since);

    return {
      totalSent,
      byStatus: statusRows.map((r) => ({ status: r.sent_status, count: r.n })),
      receivedCount: received?.n ?? 0,
      receivedRate: okCount > 0 ? (received?.n ?? 0) / okCount : 0,
      avgLatencySeconds: received?.avgLatency ?? null,
    };
  }
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `cd apps/server && bun test src/modules/push/notification-log-repo.test.ts`
Expected: PASS (전체 케이스)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/push/notification-log-repo.ts apps/server/src/modules/push/notification-log-repo.test.ts
git commit -m "feat(server): add NotificationLogRepo for push send/receive tracking"
```

---

## Task 4: `PushService`(웹)에 발송 로그 연결

**Files:**
- Modify: `apps/server/src/modules/push/service.ts`
- Modify: `apps/server/src/modules/push/push.test.ts`

**Interfaces:**
- Consumes: `NotificationLogRepo`(Task 3) — 생성자로 주입.
- Produces: `PushService` 생성자 시그니처가 `(deps, log: NotificationLogRepo, sender?: PushSender)`로 바뀐다. `PushPayload`에 `n: number` 필드 추가. Task 8(app.ts 배선)이 새 시그니처를 사용한다.

- [ ] **Step 1: 실패하는 테스트 추가**

`apps/server/src/modules/push/push.test.ts` 상단 import에 추가:

```ts
import { NotificationLogRepo } from './notification-log-repo';
```

`describe('오프라인 푸시 발송', ...)` 블록 안, 기존 테스트들 다음에 새 테스트 추가:

```ts
  test('발송 성공 시 notification_log에 ok로 기록된다', async () => {
    await subscribeBob();
    await aliceSends('기록됨');

    const log = new NotificationLogRepo(deps.db);
    const { rows } = log.list({ sort: 'sent_at', dir: 'desc', limit: 1, offset: 0 });
    expect(rows[0]).toMatchObject({
      userId: bob.user.id,
      channel: 'web',
      sentStatus: 'ok',
      bodyPreview: '기록됨',
    });
  });
```

기존 `'만료된 구독(410)은 자동으로 삭제된다'` 테스트의 마지막(`expect(calls).toBe(1);` 두 번째 호출 다음)에 로그 상태 검증을 추가:

```ts
    // 실패한 발송도 로그에는 expired로 남는다 (조용히 사라지지 않는다).
    const log = new NotificationLogRepo(deps.db);
    const { rows } = log.list({ sort: 'sent_at', dir: 'desc', limit: 10, offset: 0 });
    expect(rows.filter((r) => r.sentStatus === 'expired')).toHaveLength(1);
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `cd apps/server && bun test src/modules/push/push.test.ts`
Expected: FAIL (새 테스트에서 `notification_log`가 비어 있음 — `PushService`가 아직 기록하지 않음)

- [ ] **Step 3: `PushService` 구현 수정**

`apps/server/src/modules/push/service.ts`를 아래처럼 바꾼다.

`import` 블록에 추가:
```ts
import { NotificationLogRepo } from './notification-log-repo';
```

`PushPayload` 인터페이스에 필드 추가:
```ts
interface PushPayload {
  /** 보낸 사람 닉네임 */
  title: string;
  /** 메시지 미리보기 */
  body: string;
  /** 알림 클릭 시 열 대화방 ID */
  c: number;
  /** notification_log.id — 클라이언트 ACK가 그대로 돌려보낸다 */
  n: number;
}
```

`PushService` 클래스 생성자와 `offlineHook`/`sendToUser`를 다음으로 교체:

```ts
export class PushService {
  private repo: PushRepo;
  private sender: PushSender | null;

  constructor(
    private deps: AppDeps,
    private log: NotificationLogRepo,
    sender?: PushSender,
  ) {
    this.repo = new PushRepo(deps.db);
    const hasKeys = Boolean(deps.config.vapidPublicKey && deps.config.vapidPrivateKey);
    this.sender = sender ?? (hasKeys ? createWebPushSender(deps) : null);
  }

  get enabled(): boolean {
    return this.sender !== null;
  }

  get publicKey(): string {
    return this.deps.config.vapidPublicKey;
  }

  subscribe(userId: number, input: PushSubscribeInput): void {
    this.repo.upsert(userId, input.endpoint, input.keys.p256dh, input.keys.auth);
  }

  unsubscribe(endpoint: string): void {
    this.repo.deleteByEndpoint(endpoint);
  }

  offlineHook: OfflineMessageHook = (peerId, sender, message) => {
    if (!this.sender) return;
    void this.sendToUser(peerId, sender.nickname, previewOf(message), message.c);
  };

  /** 사용자의 모든 기기로 발송. 만료(404/410) 구독은 삭제한다. */
  private async sendToUser(
    userId: number,
    title: string,
    body: string,
    conversationId: number,
  ): Promise<void> {
    if (!this.sender) return;
    const subscriptions = this.repo.listByUser(userId);
    if (subscriptions.length === 0) {
      console.log(`[push] user=${userId} offline but has 0 subscriptions — nothing to send`);
      return;
    }
    console.log(`[push] user=${userId} sending to ${subscriptions.length} subscription(s)`);
    let ok = 0;
    let failed = 0;
    for (const subscription of subscriptions) {
      const logId = this.log.insert({
        userId,
        channel: 'web',
        conversationId,
        bodyPreview: body,
      });
      const payload: PushPayload = { title, body, c: conversationId, n: logId };
      try {
        await this.sender(subscription, JSON.stringify(payload));
        ok += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          this.repo.deleteByEndpoint(subscription.endpoint);
          this.log.markFailed(logId, 'expired', `subscription gone (${status})`);
          console.log(`[push] user=${userId} pruned expired subscription (${status})`);
        } else {
          failed += 1;
          this.log.markFailed(logId, 'error', String((error as Error)?.message ?? error));
          console.error(`[push] user=${userId} send failed (status=${status ?? 'n/a'}):`, error);
        }
      }
    }
    console.log(`[push] user=${userId} done: ok=${ok} failed=${failed}`);
  }
}
```

(참고: 기존 테스트 `expect(sent[0]?.payload).toMatchObject({ title: 'Alice', body: '안녕!', c: conversationId })`는 `toMatchObject`라 새로 추가된 `n` 필드가 있어도 그대로 통과한다.)

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `cd apps/server && bun test src/modules/push/push.test.ts`
Expected: PASS (전체)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/push/service.ts apps/server/src/modules/push/push.test.ts
git commit -m "feat(server): log web push sends to notification_log"
```

---

## Task 5: `ExpoPushService`에 발송 로그 + 영수증 영속화 연결

**Files:**
- Modify: `apps/server/src/modules/push/expo-service.ts`
- Modify: `apps/server/src/modules/push/expo.test.ts`

**Interfaces:**
- Consumes: `NotificationLogRepo`(Task 3).
- Produces: `ExpoPushService` 생성자 시그니처가 `(deps, log: NotificationLogRepo, sender?: ExpoPushSender)`로 바뀐다. `ExpoPushMessage.data`에 `n: number` 추가. 인메모리 `pendingReceipts` Map 제거.

- [ ] **Step 1: 실패하는 테스트 추가**

`apps/server/src/modules/push/expo.test.ts` 상단 import에 추가:

```ts
import { NotificationLogRepo } from './notification-log-repo';
```

`describe('오프라인 Expo 푸시 발송', ...)` 블록 안에 새 테스트 추가:

```ts
  test('발송 성공 시 notification_log에 expo 채널로 기록되고 영수증 대기 상태가 된다', async () => {
    await registerBob();
    await aliceSends('기록됨');

    const log = new NotificationLogRepo(deps.db);
    const { rows } = log.list({ sort: 'sent_at', dir: 'desc', limit: 1, offset: 0 });
    expect(rows[0]).toMatchObject({
      userId: bob.user.id,
      channel: 'expo',
      sentStatus: 'ok',
      bodyPreview: '기록됨',
      receiptStatus: 'pending',
    });
  });
```

기존 `'DeviceNotRegistered 티켓을 받으면 토큰이 삭제된다'` 테스트의 마지막(`expect(calls).toBe(1);` 두 번째 호출 다음)에 추가:

```ts
    const log = new NotificationLogRepo(deps.db);
    const { rows } = log.list({ sort: 'sent_at', dir: 'desc', limit: 10, offset: 0 });
    expect(rows.filter((r) => r.sentStatus === 'expired')).toHaveLength(1);
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `cd apps/server && bun test src/modules/push/expo.test.ts`
Expected: FAIL (새 테스트에서 `notification_log`가 비어 있음)

- [ ] **Step 3: `ExpoPushService` 구현 수정**

`apps/server/src/modules/push/expo-service.ts` 전체를 아래로 교체:

```ts
/**
 * Expo Push 서비스 — 오프라인 사용자의 네이티브 앱(iOS)으로 푸시 알림을 보낸다.
 *
 * Expo Push API(https://exp.host/--/api/v2/push/send)에 직접 fetch한다.
 * 트래픽이 소량(1:1 채팅)이라 expo-server-sdk 없이 충분하다.
 *
 * 발송 함수(sender)를 주입할 수 있어 테스트에서는 실제 API 호출 없이 검증한다.
 */
import type { AppDeps } from '../../deps';
import type { OfflineMessageHook } from '../chat/service';
import { ExpoPushRepo } from './expo-repo';
import { NotificationLogRepo } from './notification-log-repo';
import { previewOf } from './preview';

/** Expo Push API 요청 메시지 */
export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  /** 알림 탭 시 딥링크에 쓰는 데이터 — c: 대화방 ID, n: notification_log.id(ACK용) */
  data: { c: number; n: number };
  sound: 'default';
  /** iOS 앱 아이콘 배지 수 (전체 안읽음) */
  badge: number;
}

/** Expo Push API 티켓 — 발송 요청당 하나 */
export interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/** 발송 함수 시그니처 — 입력 순서대로 티켓을 반환한다 */
export type ExpoPushSender = (messages: ExpoPushMessage[]) => Promise<ExpoPushTicket[]>;

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

/** 영수증 확인까지 기다리는 시간 — Expo가 APNs 결과를 모으는 데 걸리는 여유 */
const RECEIPT_DELAY_MS = 15 * 60 * 1000;

/** exp.host 기반 기본 발송 함수 */
function createExpoSender(accessToken: string): ExpoPushSender {
  return async (messages) => {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(messages),
    });
    if (!res.ok) throw new Error(`expo push send failed: ${res.status}`);
    const { data } = (await res.json()) as { data: ExpoPushTicket[] };
    return data;
  };
}

export class ExpoPushService {
  private repo: ExpoPushRepo;
  private sender: ExpoPushSender;

  constructor(
    private deps: AppDeps,
    private log: NotificationLogRepo,
    sender?: ExpoPushSender,
  ) {
    this.repo = new ExpoPushRepo(deps.db);
    this.sender = sender ?? createExpoSender(deps.config.expoPushAccessToken);
  }

  /** 토큰 등록 (알림 켜기) */
  register(userId: number, token: string): void {
    this.repo.upsert(userId, token);
  }

  /** 본인 토큰 해지 (알림 끄기) */
  unregister(userId: number, token: string): void {
    this.repo.deleteForUser(userId, token);
  }

  /**
   * ChatService에 주입되는 오프라인 훅.
   * fire-and-forget — 발송 실패가 메시지 저장/응답에 영향을 주면 안 된다.
   */
  offlineHook: OfflineMessageHook = (peerId, sender, message) => {
    void this.sendToUser(peerId, sender.nickname, previewOf(message), message.c);
  };

  /** 사용자의 모든 기기로 발송. 만료 토큰(DeviceNotRegistered)은 삭제한다. */
  private async sendToUser(
    userId: number,
    title: string,
    body: string,
    conversationId: number,
  ): Promise<void> {
    const rows = this.repo.listByUser(userId);
    if (rows.length === 0) {
      console.log(`[expo-push] user=${userId} offline but has 0 tokens — nothing to send`);
      return;
    }

    const badge = this.repo.countUnread(userId);
    const logIds = rows.map(() =>
      this.log.insert({ userId, channel: 'expo', conversationId, bodyPreview: body }),
    );
    const messages: ExpoPushMessage[] = rows.map((row, i) => ({
      to: row.token,
      title,
      body,
      data: { c: conversationId, n: logIds[i]! },
      sound: 'default',
      badge,
    }));

    console.log(`[expo-push] user=${userId} sending to ${rows.length} token(s)`);
    try {
      const tickets = await this.sender(messages);
      let ok = 0;
      tickets.forEach((ticket, index) => {
        const token = rows[index]?.token;
        const logId = logIds[index];
        if (!token || logId === undefined) return;
        if (ticket.status === 'error') {
          if (ticket.details?.error === 'DeviceNotRegistered') {
            this.repo.deleteByToken(token);
            this.log.markFailed(logId, 'expired', 'DeviceNotRegistered');
            console.log(`[expo-push] user=${userId} pruned unregistered token`);
          } else {
            this.log.markFailed(logId, 'error', ticket.details?.error ?? ticket.message ?? 'unknown');
            console.error(`[expo-push] user=${userId} ticket error: ${ticket.details?.error}`);
          }
        } else {
          ok += 1;
          // APNs 단계의 실패(DeviceNotRegistered)는 영수증으로만 알 수 있다.
          if (ticket.id) this.log.markTicketPending(logId, ticket.id, token);
        }
      });
      console.log(`[expo-push] user=${userId} done: ok=${ok}/${tickets.length}`);
    } catch (error) {
      // 발송 요청 자체가 실패 — 이번에 만든 로그 행 전부를 실패로 마감한다.
      for (const logId of logIds) {
        this.log.markFailed(logId, 'error', String((error as Error)?.message ?? error));
      }
      console.error(`[expo-push] user=${userId} send failed:`, error);
    }

    // 이전 발송분의 영수증을 게으르게 확인한다 (별도 스케줄러 없이).
    await this.checkPendingReceipts();
  }

  /** 15분 이상 지난 로그의 영수증을 확인하고 무효 토큰을 정리한다. */
  private async checkPendingReceipts(): Promise<void> {
    const due = this.log.listPendingExpoReceipts(RECEIPT_DELAY_MS);
    if (due.length === 0) return;

    try {
      const res = await fetch(EXPO_RECEIPTS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.deps.config.expoPushAccessToken
            ? { Authorization: `Bearer ${this.deps.config.expoPushAccessToken}` }
            : {}),
        },
        body: JSON.stringify({ ids: due.map((d) => d.expoTicketId) }),
      });
      if (!res.ok) return;
      const { data } = (await res.json()) as {
        data: Record<string, { status: 'ok' | 'error'; details?: { error?: string } }>;
      };
      for (const { id: logId, expoTicketId, expoToken } of due) {
        const receipt = data[expoTicketId];
        if (!receipt) continue;
        if (receipt.details?.error === 'DeviceNotRegistered') {
          this.repo.deleteByToken(expoToken);
          this.log.markReceiptDeviceGone(logId);
          console.log('[expo-push] pruned token via receipt');
        } else {
          this.log.updateReceiptStatus(logId, receipt.status);
        }
      }
    } catch (error) {
      // 영수증 확인 실패는 다음 발송 때 재시도된다.
      console.error('[expo-push] receipt check failed:', error);
    }
  }
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `cd apps/server && bun test src/modules/push/expo.test.ts`
Expected: PASS (전체 — 기존 `toMatchObject({ to, title, body, data: { c: conversationId }, ... })` 검증도 `n` 필드가 추가돼도 그대로 통과)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/push/expo-service.ts apps/server/src/modules/push/expo.test.ts
git commit -m "feat(server): log expo push sends + persist receipt tracking to notification_log"
```

---

## Task 6: `POST /api/push/ack` 라우트

**Files:**
- Modify: `apps/server/src/modules/push/routes.ts`
- Modify: `apps/server/src/modules/push/push.test.ts`

**Interfaces:**
- Consumes: `pushAckSchema`(Task 2), `NotificationLogRepo.markReceived`(Task 3).
- Produces: `pushRoutes(deps, service, expo, notificationLog)` — 4번째 인자 추가. `POST /api/push/ack` 엔드포인트.

- [ ] **Step 1: 실패하는 테스트 추가**

`apps/server/src/modules/push/push.test.ts` 파일 맨 끝(`구독 관리` describe 블록 다음)에 추가:

```ts
describe('POST /api/push/ack', () => {
  test('로그 id로 수신 시각을 기록한다', async () => {
    await subscribeBob();
    await aliceSends('안녕!');
    const log = new NotificationLogRepo(deps.db);
    const before = log.list({ sort: 'sent_at', dir: 'desc', limit: 1, offset: 0 }).rows[0]!;
    expect(before.receivedAt).toBeNull();

    const res = await jsonRequest(app, '/api/push/ack', {
      method: 'POST',
      cookie: bob.cookie,
      body: { n: before.id },
    });
    expect(res.status).toBe(200);

    const after = log.list({ sort: 'sent_at', dir: 'desc', limit: 1, offset: 0 }).rows[0]!;
    expect(after.receivedAt).not.toBeNull();
    expect(after.receivedStatus).toBe('received');
  });

  test('다른 사용자의 로그는 ACK로 갱신되지 않는다', async () => {
    await subscribeBob();
    await aliceSends('안녕!');
    const log = new NotificationLogRepo(deps.db);
    const logId = log.list({ sort: 'sent_at', dir: 'desc', limit: 1, offset: 0 }).rows[0]!.id;

    await jsonRequest(app, '/api/push/ack', {
      method: 'POST',
      cookie: alice.cookie,
      body: { n: logId },
    });

    const after = log.list({ sort: 'sent_at', dir: 'desc', limit: 1, offset: 0 }).rows[0]!;
    expect(after.receivedAt).toBeNull();
  });

  test('인증 없이 호출하면 401', async () => {
    const res = await jsonRequest(app, '/api/push/ack', { method: 'POST', body: { n: 1 } });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `cd apps/server && bun test src/modules/push/push.test.ts`
Expected: FAIL — `/api/push/ack`가 404 (라우트 없음)

- [ ] **Step 3: 라우트 구현**

`apps/server/src/modules/push/routes.ts` 전체를 아래로 교체:

```ts
/**
 * Web Push REST 라우트: /api/push/*
 */
import { validator as zValidator } from 'hono-openapi/zod';
import {
  expoPushRegisterSchema,
  expoPushUnregisterSchema,
  pushAckSchema,
  pushSubscribeSchema,
  pushUnsubscribeSchema,
} from '@litechat/types';
import { Hono } from 'hono';
import type { AppEnv } from '../../app';
import type { AppDeps } from '../../deps';
import { requireAuth } from '../../middleware/auth';
import type { ExpoPushService } from './expo-service';
import type { NotificationLogRepo } from './notification-log-repo';
import type { PushService } from './service';

export function pushRoutes(
  deps: AppDeps,
  service: PushService,
  expo: ExpoPushService,
  notificationLog: NotificationLogRepo,
) {
  return (
    new Hono<AppEnv>()
      .use('*', requireAuth(deps))
      // 구독에 필요한 VAPID 공개키 + 기능 활성화 여부
      .get('/key', (c) => c.json({ key: service.publicKey, enabled: service.enabled }, 200))
      // 알림 켜기 — 브라우저 PushSubscription 등록
      .post('/subscribe', zValidator('json', pushSubscribeSchema), (c) => {
        service.subscribe(c.var.userId, c.req.valid('json'));
        return c.json({ ok: true }, 201);
      })
      // 알림 끄기
      .post('/unsubscribe', zValidator('json', pushUnsubscribeSchema), (c) => {
        service.unsubscribe(c.req.valid('json').endpoint);
        return c.json({ ok: true }, 200);
      })
      // 네이티브 앱 알림 켜기 — Expo Push 토큰 등록
      .post('/expo/register', zValidator('json', expoPushRegisterSchema), (c) => {
        expo.register(c.var.userId, c.req.valid('json').token);
        return c.json({ ok: true }, 201);
      })
      // 네이티브 앱 알림 끄기 — 본인 토큰만 해지된다
      .post('/expo/unregister', zValidator('json', expoPushUnregisterSchema), (c) => {
        expo.unregister(c.var.userId, c.req.valid('json').token);
        return c.json({ ok: true }, 200);
      })
      // 클라이언트가 알림을 실제로 받았을 때 보내는 ACK — n은 notification_log.id
      .post('/ack', zValidator('json', pushAckSchema), (c) => {
        const ua = c.req.header('user-agent') ?? null;
        notificationLog.markReceived(c.req.valid('json').n, c.var.userId, ua);
        return c.json({ ok: true }, 200);
      })
  );
}
```

- [ ] **Step 4: `app.ts`에서 `pushRoutes` 호출부를 임시로 4번째 인자 없이 두면 타입 오류가 나므로, Task 8에서 함께 배선한다는 점을 확인**

이 태스크만으로는 `app.ts`의 `pushRoutes(deps, pushService, expoPushService)` 호출이 타입 오류를 낸다 — Task 8에서 `PushService`/`ExpoPushService` 생성자와 함께 한 번에 고친다. 지금은 `bun test`가 아니라 타입 체크(`tsc --noEmit`)가 실패하는 게 정상이다.

Run: `cd apps/server && bun test src/modules/push/push.test.ts`
Expected: 여전히 FAIL — `app.ts`가 `NotificationLogRepo` 없이 `PushService`/`ExpoPushService`를 생성하고 있어 컴파일 자체가 안 된다. **이 상태로 커밋하지 말고 Task 8까지 이어서 진행한다.**

- [ ] **Step 5: Commit은 Task 8 완료 후 한 번에 (아래 Task 8 Step 참고)**

이 태스크는 Task 8과 같은 커밋 경계에서 마무리된다 — `routes.ts`만 단독으로 커밋하면 빌드가 깨진 상태로 히스토리에 남기 때문이다.

---

## Task 7: Admin API — `/api/admin/notifications`, `/api/admin/notifications/summary`

**Files:**
- Modify: `apps/server/src/modules/admin/routes.ts`

**Interfaces:**
- Consumes: `NotificationLogRepo`(Task 3).
- Produces: `adminRoutes(deps, analyticsService, notificationLog)` — 3번째 인자 추가. `GET /api/admin/notifications`, `GET /api/admin/notifications/summary`.

- [ ] **Step 1: import + 함수 시그니처 수정**

`apps/server/src/modules/admin/routes.ts` 상단 import에 추가:

```ts
import type { NotificationLogRepo } from '../push/notification-log-repo';
```

함수 시그니처 변경:

```ts
export function adminRoutes(
  deps: AppDeps,
  analyticsService: AnalyticsService,
  notificationLog: NotificationLogRepo,
) {
```

- [ ] **Step 2: 라우트 두 개 추가**

`apps/server/src/modules/admin/routes.ts`의 마지막 라우트(`.get('/vitals', ...)`) 바로 다음에 추가 (체이닝이므로 `.get('/vitals', ...)` 뒤의 세미콜론을 지우고 이어붙인다):

```ts
    .get('/vitals', requireAdmin(deps), (c) => {
      const metric = c.req.query('metric') ?? 'LCP';
      const days = Number(c.req.query('days') ?? 30);
      return c.json(analyticsService.queries.vitalsTrend(metric, days), 200);
    })
    // 알림 발송/수신 로그 데이터 탐색기 — 수신자/채널/발송상태/수신상태/기간 필터
    .get('/notifications', requireAdmin(deps), (c) => {
      const q = (name: string) => c.req.query(name);
      const page = Math.max(1, Number(q('page') ?? 1) || 1);
      const pageSize = Math.min(200, Math.max(1, Number(q('pageSize') ?? 50) || 50));
      const channel = q('channel');
      const sentStatus = q('sentStatus');
      const receivedStatus = q('receivedStatus');
      const result = notificationLog.list({
        userId: q('userId') ? Number(q('userId')) : undefined,
        channel: channel === 'web' || channel === 'expo' ? channel : undefined,
        sentStatus:
          sentStatus === 'ok' || sentStatus === 'error' || sentStatus === 'expired'
            ? sentStatus
            : undefined,
        receivedStatus:
          receivedStatus === 'received' ||
          receivedStatus === 'pending' ||
          receivedStatus === 'presumed_lost' ||
          receivedStatus === 'n-a'
            ? receivedStatus
            : undefined,
        from: q('from') ? Number(q('from')) : undefined,
        to: q('to') ? Number(q('to')) : undefined,
        sort: q('sort') === 'received_at' ? 'received_at' : 'sent_at',
        dir: q('dir') === 'asc' ? 'asc' : 'desc',
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      return c.json({ ...result, page, pageSize }, 200);
    })
    // 알림 발송 KPI 요약 — 대시보드 상단 카드용
    .get('/notifications/summary', requireAdmin(deps), (c) => {
      const days = Number(c.req.query('days') ?? 30);
      return c.json(notificationLog.summary(days), 200);
    });
```

(파일 끝의 `.get('/vitals', ...)` 다음에 있던 `;`는 새로 추가한 마지막 라우트(`/notifications/summary`) 뒤로 옮긴다.)

- [ ] **Step 3: Commit은 Task 8과 함께 (app.ts 배선 없이는 컴파일 불가)**

---

## Task 8: `app.ts` 배선 — Task 6/7 완성

**Files:**
- Modify: `apps/server/src/app.ts`

**Interfaces:**
- Consumes: `NotificationLogRepo`(Task 3), 수정된 `PushService`/`ExpoPushService`(Task 4/5), 수정된 `pushRoutes`/`adminRoutes`(Task 6/7).
- Produces: 서버 전체가 다시 컴파일/부팅된다 — 이 태스크가 끝나야 Task 6·7이 실제로 동작한다.

- [ ] **Step 1: import 추가**

`apps/server/src/app.ts` 상단 import 블록에 추가 (알파벳 순서상 `pushRoutes` import 바로 앞):

```ts
import { NotificationLogRepo } from './modules/push/notification-log-repo';
```

- [ ] **Step 2: `createApp` 내부 배선 수정**

`createApp` 함수 본문을 아래로 교체:

```ts
export function createApp(deps: AppDeps, options: CreateAppOptions = {}) {
  // 발송/수신 로그 — PushService/ExpoPushService/admin 라우트가 공유하는 단일 인스턴스.
  const notificationLog = new NotificationLogRepo(deps.db);
  // 상대가 오프라인일 때 푸시를 쏘는 훅을 ChatService에 주입한다.
  // Web Push(브라우저/PWA)와 Expo Push(네이티브 앱)를 하나의 훅으로 합성한다.
  const pushService = new PushService(deps, notificationLog, options.pushSender);
  const expoPushService = new ExpoPushService(deps, notificationLog, options.expoPushSender);
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
    // 헬스체크 — 배포 환경(Dokploy)의 컨테이너 상태 확인용
    .get('/api/health', (c) => c.json({ ok: true }))
    .route('/api/auth', authRoutes(deps))
    .route('/api/friends', friendsRoutes(deps))
    .route('/api/chat', chatRoutes(deps, chatService))
    .route('/api/images', imagesRoutes(deps, imagesService))
    .route('/api/push', pushRoutes(deps, pushService, expoPushService, notificationLog))
    .route('/api/analytics', analyticsRoutes(analyticsService))
    .route('/api/admin', adminRoutes(deps, analyticsService, notificationLog))
    .route('/img', imgRoutes(deps, imagesService))
    .route('/', wsRoutes(deps, chatService));

  // OpenAPI 명세(/openapi.json) + 문서 UI(/docs) — 모든 라우트 등록 후에 붙인다.
  attachDocs(app);

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
```

- [ ] **Step 3: 서버 전체 테스트 실행 → 통과 확인**

Run: `cd apps/server && bun test`
Expected: PASS (전체 — Task 4/5/6에서 추가한 테스트 포함)

- [ ] **Step 4: 타입 체크**

Run: `cd apps/server && bunx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 5: Commit (Task 6·7·8을 한 번에)**

```bash
git add apps/server/src/app.ts apps/server/src/modules/push/routes.ts apps/server/src/modules/push/push.test.ts apps/server/src/modules/admin/routes.ts
git commit -m "feat(server): wire notification_log into push ack route and admin API"
```

---

## Task 9: 웹 클라이언트 — 서비스워커 ACK

**Files:**
- Modify: `apps/web/src/sw.ts`

**Interfaces:**
- Consumes: 서버가 페이로드에 실어 보내는 `n`(Task 4).
- Produces: `push` 이벤트마다 `POST /api/push/ack` 호출(같은 오리진, 쿠키 자동 포함).

- [ ] **Step 1: `push` 이벤트 핸들러 수정**

`apps/web/src/sw.ts`의 `push` 이벤트 리스너를 아래로 교체:

```ts
/** 푸시 수신 — 서버가 보낸 { title, body, c, n } 페이로드를 알림으로 표시하고, 받았다고 서버에 알린다 */
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload: { title?: string; body?: string; c?: number; n?: number };
  try {
    payload = event.data.json() as typeof payload;
  } catch {
    return;
  }
  const showNotification = self.registration.showNotification(payload.title ?? 'litechat', {
    body: payload.body ?? '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: `conv-${payload.c ?? 0}`, // 같은 대화방 알림은 하나로 합친다
    data: { c: payload.c },
  });
  // 수신 ACK — 같은 오리진 요청이라 세션 쿠키가 자동으로 실린다. 실패해도 알림 표시는 막지 않는다.
  const ack =
    typeof payload.n === 'number'
      ? fetch('/api/push/ack', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ n: payload.n }),
        }).catch(() => {})
      : Promise.resolve();
  event.waitUntil(Promise.all([showNotification, ack]));
});
```

- [ ] **Step 2: 타입 체크**

Run: `cd apps/web && bunx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/sw.ts
git commit -m "feat(web): ack push notifications from the service worker"
```

---

## Task 10: 앱 클라이언트 — Expo 알림 수신 ACK

**Files:**
- Modify: `apps/app/src/lib/notifications.ts`
- Modify: `apps/app/src/app/_layout.tsx`
- Test: `apps/app/src/lib/__tests__/notification-ack.test.ts`

**Interfaces:**
- Consumes: 서버가 `data.n`으로 보내는 로그 id(Task 5), `api`/`unwrap`(`apps/app/src/lib/api.ts`).
- Produces: `useNotificationReceivedAck()` 훅 — `_layout.tsx`에서 마운트.

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/app/src/lib/__tests__/notification-ack.test.ts` 생성:

```ts
/**
 * 알림 수신 ACK 테스트 — data.n을 서버에 되돌려 보내는지 확인
 */
import { renderHook } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { useNotificationReceivedAck } from '../notifications';

function received(data: Record<string, unknown>) {
  return { request: { content: { data } } } as unknown as Notifications.Notification;
}

/** 마지막으로 등록된 수신 리스너를 꺼낸다 */
function lastListener(): (n: Notifications.Notification) => void {
  const { calls } = jest.mocked(Notifications.addNotificationReceivedListener).mock;
  return calls[calls.length - 1]![0] as (n: Notifications.Notification) => void;
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
});

describe('useNotificationReceivedAck', () => {
  test('data.n이 있으면 /api/push/ack로 ACK를 보낸다', () => {
    renderHook(() => useNotificationReceivedAck());
    lastListener()(received({ c: 5, n: 42 }));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = jest.mocked(global.fetch).mock.calls[0]!;
    expect(String(url)).toContain('/api/push/ack');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ n: 42 });
  });

  test('data.n이 없으면 ACK를 보내지 않는다', () => {
    renderHook(() => useNotificationReceivedAck());
    lastListener()(received({ c: 5 }));

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('언마운트 시 리스너를 해제한다', () => {
    const { unmount } = renderHook(() => useNotificationReceivedAck());
    const subscription = jest.mocked(Notifications.addNotificationReceivedListener).mock.results[0]!
      .value as { remove: jest.Mock };
    unmount();
    expect(subscription.remove).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `cd apps/app && bunx jest src/lib/__tests__/notification-ack.test.ts`
Expected: FAIL — `useNotificationReceivedAck is not a function`

- [ ] **Step 3: 훅 구현**

`apps/app/src/lib/notifications.ts`의 `useBadgeSync` 함수 앞에 추가:

```ts
/**
 * 알림 수신 ACK — 알림이 실제로 도착했을 때(포그라운드/백그라운드, 프로세스가 살아있는
 * 동안) 서버에 수신 시각을 기록한다. 루트 레이아웃에서 한 번 마운트한다.
 *
 * 한계: 앱이 완전히 종료된 상태로 도착한 알림은 이 리스너가 붙어 있지 않아 ACK가
 * 오지 않는다 — 딥링크(useNotificationDeepLink)와 달리 콜드 스타트 시점의 재발화가
 * 없다(expo-notifications가 "받았다"는 과거 이벤트를 다시 쏴주지 않는다).
 */
export function useNotificationReceivedAck(): void {
  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      const logId = notification.request.content.data?.n;
      if (typeof logId !== 'number') return;
      void unwrap(api.api.push.ack.$post({ json: { n: logId } })).catch(() => {});
    });
    return () => subscription.remove();
  }, []);
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `cd apps/app && bunx jest src/lib/__tests__/notification-ack.test.ts`
Expected: PASS (전체)

- [ ] **Step 5: 루트 레이아웃에 훅 마운트**

`apps/app/src/app/_layout.tsx`의 import에서:

```ts
import { useNotificationDeepLink } from '@/lib/notifications';
```

를

```ts
import { useNotificationDeepLink, useNotificationReceivedAck } from '@/lib/notifications';
```

로 바꾸고, `Root()` 함수 안 `useNotificationDeepLink(ready);` 다음 줄에 추가:

```tsx
  // 알림 탭 → 대화방 딥링크 (콜드 스타트 포함) — Stack이 마운트된 뒤에만 push
  useNotificationDeepLink(ready);
  // 알림 수신 ACK — 프로세스가 살아있는 동안 도착한 알림은 서버에 수신 시각을 기록한다
  useNotificationReceivedAck();
```

- [ ] **Step 6: 앱 전체 테스트 + 타입 체크**

Run: `cd apps/app && bunx jest && bunx tsc --noEmit`
Expected: 전체 PASS, 타입 오류 없음

- [ ] **Step 7: Commit**

```bash
git add apps/app/src/lib/notifications.ts apps/app/src/lib/__tests__/notification-ack.test.ts apps/app/src/app/_layout.tsx
git commit -m "feat(app): ack received push notifications to the server"
```

---

## Task 11: 대시보드 API 클라이언트 — 타입 + `adminApi` 메서드

**Files:**
- Modify: `apps/dashboard/src/api.ts`

**Interfaces:**
- Consumes: `GET /api/admin/notifications`, `GET /api/admin/notifications/summary`(Task 7).
- Produces: `NotificationLogRow`, `NotificationsResult`, `NotificationsParams`, `NotificationSummary` 타입, `adminApi.notifications()`, `adminApi.notificationsSummary()`. Task 12(대시보드 페이지)가 사용.

- [ ] **Step 1: 타입 추가**

`apps/dashboard/src/api.ts`의 `VitalsPoint` 인터페이스 다음, `export const adminApi = {` 앞에 추가:

```ts
export interface NotificationLogRow {
  id: number;
  userId: number;
  username: string | null;
  nickname: string | null;
  channel: 'web' | 'expo';
  conversationId: number | null;
  bodyPreview: string;
  sentAt: number;
  sentStatus: 'ok' | 'error' | 'expired';
  sentError: string | null;
  receiptStatus: 'pending' | 'ok' | 'error' | null;
  receiptCheckedAt: number | null;
  receivedAt: number | null;
  receivedStatus: 'received' | 'pending' | 'presumed_lost' | 'n-a';
}

export interface NotificationsResult {
  rows: NotificationLogRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface NotificationsParams {
  userId?: number;
  channel?: string;
  sentStatus?: string;
  receivedStatus?: string;
  from?: number;
  to?: number;
  sort?: 'sent_at' | 'received_at';
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface NotificationSummary {
  totalSent: number;
  byStatus: { status: string; count: number }[];
  receivedCount: number;
  receivedRate: number;
  avgLatencySeconds: number | null;
}
```

- [ ] **Step 2: `adminApi`에 메서드 추가**

`apps/dashboard/src/api.ts`의 `adminApi` 객체, `sessions: (...)` 다음에 추가:

```ts
  notifications: (params: NotificationsParams = {}) => {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') qs.set(key, String(value));
    }
    return request<NotificationsResult>(`/notifications?${qs.toString()}`);
  },
  notificationsSummary: (days = 30) =>
    request<NotificationSummary>(`/notifications/summary?days=${days}`),
```

- [ ] **Step 3: 타입 체크**

Run: `cd apps/dashboard && bunx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/api.ts
git commit -m "feat(dashboard): add notifications API client"
```

---

## Task 12: `KpiCard` 컴포넌트 추출 (OverviewPage 재사용 준비)

**Files:**
- Create: `apps/dashboard/src/components/KpiCard.tsx`
- Modify: `apps/dashboard/src/pages/OverviewPage.tsx`

**Interfaces:**
- Produces: `KpiCard` 컴포넌트 — Task 13(NotificationsPage)이 재사용.

- [ ] **Step 1: 컴포넌트 파일 생성**

`apps/dashboard/src/components/KpiCard.tsx` 생성:

```tsx
/**
 * KPI 카드 — 라벨 + 큰 숫자/문자열 값. Overview/Notifications 페이지가 공유한다.
 */
export function KpiCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-hairline bg-card p-5">
      <p className="text-sm text-ink-mute">{label}</p>
      <p className="tnum display mt-1 text-3xl">{value}</p>
    </div>
  );
}
```

- [ ] **Step 2: `OverviewPage.tsx`에서 로컬 정의 제거하고 import**

`apps/dashboard/src/pages/OverviewPage.tsx`에서 아래 블록을 삭제:

```tsx
function KpiCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-hairline bg-card p-5">
      <p className="text-sm text-ink-mute">{label}</p>
      <p className="tnum display mt-1 text-3xl">{value}</p>
    </div>
  );
}
```

`import { adminApi, type Overview, type TimeseriesPoint } from '../api';` 다음 줄에 추가:

```tsx
import { KpiCard } from '../components/KpiCard';
```

- [ ] **Step 3: 대시보드 개발 서버로 개요 페이지가 그대로 보이는지 확인 (동작 변화 없음)**

Run: `cd apps/dashboard && bunx tsc --noEmit`
Expected: 오류 없음 (동작은 100% 동일 — 순수 리팩터링)

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/KpiCard.tsx apps/dashboard/src/pages/OverviewPage.tsx
git commit -m "refactor(dashboard): extract KpiCard into a shared component"
```

---

## Task 13: 대시보드 페이지 — `NotificationsPage`

**Files:**
- Create: `apps/dashboard/src/pages/NotificationsPage.tsx`
- Modify: `apps/dashboard/src/App.tsx`

**Interfaces:**
- Consumes: `adminApi.notifications`/`adminApi.notificationsSummary`(Task 11), `KpiCard`(Task 12).
- Produces: 라우트 `/notifications`, 네비 탭 "알림 로그".

- [ ] **Step 1: 페이지 컴포넌트 생성**

`apps/dashboard/src/pages/NotificationsPage.tsx` 생성:

```tsx
/**
 * 알림 발송/수신 로그 — 웹/앱 푸시가 실제로 나갔는지, 도착했는지 확인하는 데이터 탐색기.
 * 필터(수신자/채널/발송상태/수신상태/기간) + 정렬 + 페이지네이션.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  adminApi,
  type NotificationsParams,
  type NotificationsResult,
  type NotificationSummary,
  type UserVisit,
} from '../api';
import { KpiCard } from '../components/KpiCard';

function formatDate(epochSeconds: number | null): string {
  if (epochSeconds === null) return '—';
  return new Date(epochSeconds * 1000).toLocaleString('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** 초 단위 값을 "12초"/"3분"/"2시간" 형태로 */
function formatLatency(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${Math.round(seconds)}초`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}분`;
  return `${Math.round(seconds / 3600)}시간`;
}

/** yyyy-mm-dd(로컬) → epoch 초. endOfDay면 그날 23:59:59 */
function dateToEpoch(value: string, endOfDay: boolean): number | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T${endOfDay ? '23:59:59' : '00:00:00'}`);
  return Math.floor(date.getTime() / 1000);
}

const CHANNEL_LABEL: Record<string, string> = { web: '웹', expo: '앱' };
const SENT_STATUS_LABEL: Record<string, string> = { ok: '성공', error: '오류', expired: '만료' };
const RECEIPT_STATUS_LABEL: Record<string, string> = { pending: '대기중', ok: '접수확인', error: '오류' };
const RECEIVED_STATUS_LABEL: Record<string, string> = {
  received: '수신함',
  pending: '대기중',
  presumed_lost: '미수신 추정',
  'n-a': '발송 실패',
};

function sentBadgeClass(status: string): string {
  if (status === 'ok') return 'border-emerald-400/40 text-emerald-400';
  if (status === 'expired') return 'border-amber-400/60 text-amber-400';
  return 'border-danger/40 text-danger';
}

function receivedBadgeClass(status: string): string {
  if (status === 'received') return 'border-emerald-400/40 text-emerald-400';
  if (status === 'pending') return 'border-amber-400/60 text-amber-400';
  if (status === 'presumed_lost') return 'border-danger/40 text-danger';
  return 'border-hairline text-ink-mute';
}

function Badge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${className}`}>
      {label}
    </span>
  );
}

const CHANNEL_OPTIONS = ['', 'web', 'expo'] as const;
const SENT_STATUS_OPTIONS = ['', 'ok', 'error', 'expired'] as const;
const RECEIVED_STATUS_OPTIONS = ['', 'received', 'pending', 'presumed_lost', 'n-a'] as const;
const PAGE_SIZE = 50;

export default function NotificationsPage() {
  const [users, setUsers] = useState<UserVisit[]>([]);
  const [result, setResult] = useState<NotificationsResult | null>(null);
  const [summary, setSummary] = useState<NotificationSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const [userId, setUserId] = useState('');
  const [channel, setChannel] = useState('');
  const [sentStatus, setSentStatus] = useState('');
  const [receivedStatus, setReceivedStatus] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sort, setSort] = useState<'sent_at' | 'received_at'>('sent_at');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  useEffect(() => {
    void adminApi.usersVisits().then(setUsers);
    void adminApi.notificationsSummary(30).then(setSummary);
  }, []);

  const load = useCallback(() => {
    const params: NotificationsParams = {
      userId: userId ? Number(userId) : undefined,
      channel: channel || undefined,
      sentStatus: sentStatus || undefined,
      receivedStatus: receivedStatus || undefined,
      from: dateToEpoch(fromDate, false),
      to: dateToEpoch(toDate, true),
      sort,
      dir,
      page,
      pageSize: PAGE_SIZE,
    };
    setLoading(true);
    void adminApi
      .notifications(params)
      .then(setResult)
      .finally(() => setLoading(false));
  }, [userId, channel, sentStatus, receivedStatus, fromDate, toDate, sort, dir, page]);

  useEffect(() => {
    load();
  }, [load]);

  function withPageReset<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }

  function toggleSort(column: 'sent_at' | 'received_at') {
    if (sort === column) {
      setDir(dir === 'desc' ? 'asc' : 'desc');
    } else {
      setSort(column);
      setDir('desc');
    }
    setPage(1);
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;
  const sortIndicator = (column: string) => (sort === column ? (dir === 'desc' ? ' ↓' : ' ↑') : '');
  const inputClass =
    'rounded-md border border-hairline bg-shell px-3 py-1.5 text-sm outline-none focus:border-primary-soft';
  const okCount = summary?.byStatus.find((s) => s.status === 'ok')?.count ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="발송 건수 (30일)" value={summary?.totalSent ?? '–'} />
        <KpiCard
          label="발송 성공률"
          value={summary ? `${Math.round((okCount / Math.max(1, summary.totalSent)) * 100)}%` : '–'}
        />
        <KpiCard
          label="수신 확인율"
          value={summary ? `${Math.round(summary.receivedRate * 100)}%` : '–'}
        />
        <KpiCard
          label="평균 수신 지연"
          value={summary ? formatLatency(summary.avgLatencySeconds) : '–'}
        />
      </div>

      {/* 필터 바 */}
      <div className="rounded-xl border border-hairline bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-ink-mute">
            수신자
            <select
              value={userId}
              onChange={(e) => withPageReset(setUserId)(e.target.value)}
              className={inputClass}
            >
              <option value="">전체</option>
              {users.map((user) => (
                <option key={user.userId} value={user.userId}>
                  {user.nickname} (@{user.username})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-mute">
            채널
            <select
              value={channel}
              onChange={(e) => withPageReset(setChannel)(e.target.value)}
              className={inputClass}
            >
              {CHANNEL_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === '' ? '전체' : CHANNEL_LABEL[option]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-mute">
            발송상태
            <select
              value={sentStatus}
              onChange={(e) => withPageReset(setSentStatus)(e.target.value)}
              className={inputClass}
            >
              {SENT_STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === '' ? '전체' : SENT_STATUS_LABEL[option]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-mute">
            수신상태
            <select
              value={receivedStatus}
              onChange={(e) => withPageReset(setReceivedStatus)(e.target.value)}
              className={inputClass}
            >
              {RECEIVED_STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === '' ? '전체' : RECEIVED_STATUS_LABEL[option]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-mute">
            시작일
            <input
              type="date"
              value={fromDate}
              onChange={(e) => withPageReset(setFromDate)(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-mute">
            종료일
            <input
              type="date"
              value={toDate}
              onChange={(e) => withPageReset(setToDate)(e.target.value)}
              className={inputClass}
            />
          </label>
          <span className="ml-auto text-xs text-ink-mute tnum">
            {result ? `총 ${result.total.toLocaleString()}건` : ''}
            {loading ? ' · 불러오는 중…' : ''}
          </span>
        </div>
      </div>

      {/* 데이터 그리드 */}
      <div className="rounded-xl border border-hairline bg-card">
        <div className="max-h-[600px] overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-card text-ink-mute">
              <tr className="border-b border-hairline">
                <th
                  className="cursor-pointer whitespace-nowrap px-4 py-2.5 font-normal hover:text-white"
                  onClick={() => toggleSort('sent_at')}
                >
                  발송시각{sortIndicator('sent_at')}
                </th>
                <th className="whitespace-nowrap px-4 py-2.5 font-normal">수신자</th>
                <th className="whitespace-nowrap px-4 py-2.5 font-normal">채널</th>
                <th className="whitespace-nowrap px-4 py-2.5 font-normal">발송상태</th>
                <th className="whitespace-nowrap px-4 py-2.5 font-normal">영수증</th>
                <th
                  className="cursor-pointer whitespace-nowrap px-4 py-2.5 font-normal hover:text-white"
                  onClick={() => toggleSort('received_at')}
                >
                  수신시각{sortIndicator('received_at')}
                </th>
                <th className="whitespace-nowrap px-4 py-2.5 font-normal">수신여부</th>
                <th className="whitespace-nowrap px-4 py-2.5 font-normal">지연</th>
                <th className="px-4 py-2.5 font-normal">미리보기</th>
              </tr>
            </thead>
            <tbody>
              {result?.rows.map((row) => (
                <tr key={row.id} className="border-b border-hairline/50 hover:bg-shell/50">
                  <td className="tnum whitespace-nowrap px-4 py-2">{formatDate(row.sentAt)}</td>
                  <td className="whitespace-nowrap px-4 py-2">
                    {row.nickname ?? '—'} <span className="text-ink-mute">@{row.username ?? '?'}</span>
                  </td>
                  <td className="px-4 py-2">{CHANNEL_LABEL[row.channel] ?? row.channel}</td>
                  <td className="px-4 py-2" title={row.sentError ?? ''}>
                    <Badge
                      label={SENT_STATUS_LABEL[row.sentStatus] ?? row.sentStatus}
                      className={sentBadgeClass(row.sentStatus)}
                    />
                  </td>
                  <td className="px-4 py-2 text-ink-mute">
                    {row.receiptStatus ? (RECEIPT_STATUS_LABEL[row.receiptStatus] ?? row.receiptStatus) : '—'}
                  </td>
                  <td className="tnum whitespace-nowrap px-4 py-2 text-ink-mute">
                    {formatDate(row.receivedAt)}
                  </td>
                  <td className="px-4 py-2">
                    <Badge
                      label={RECEIVED_STATUS_LABEL[row.receivedStatus] ?? row.receivedStatus}
                      className={receivedBadgeClass(row.receivedStatus)}
                    />
                  </td>
                  <td className="tnum whitespace-nowrap px-4 py-2 text-ink-mute">
                    {row.receivedAt !== null ? formatLatency(row.receivedAt - row.sentAt) : '—'}
                  </td>
                  <td className="max-w-72 truncate px-4 py-2 text-ink-mute" title={row.bodyPreview}>
                    {row.bodyPreview || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {result && result.rows.length === 0 && (
            <p className="py-10 text-center text-ink-mute">조건에 맞는 알림 기록이 없어요.</p>
          )}
        </div>

        {/* 페이지네이션 */}
        <div className="flex items-center justify-between border-t border-hairline px-4 py-2.5 text-xs text-ink-mute">
          <span className="tnum">
            페이지 {result?.page ?? page} / {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="rounded-md border border-hairline px-3 py-1 hover:text-white disabled:opacity-40"
            >
              이전
            </button>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              className="rounded-md border border-hairline px-3 py-1 hover:text-white disabled:opacity-40"
            >
              다음
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 라우트/네비 탭 추가**

`apps/dashboard/src/App.tsx`에서 lazy import 블록에 추가:

```ts
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
```

`Shell()`의 `<nav>` 안, `<Tab to="/vitals" label="웹 바이탈" />` 다음에 추가:

```tsx
        <Tab to="/notifications" label="알림 로그" />
```

`<Routes>` 안, `<Route path="/vitals" element={<VitalsPage />} />` 다음에 추가:

```tsx
          <Route path="/notifications" element={<NotificationsPage />} />
```

- [ ] **Step 3: 타입 체크**

Run: `cd apps/dashboard && bunx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/pages/NotificationsPage.tsx apps/dashboard/src/App.tsx
git commit -m "feat(dashboard): add notification delivery log page"
```

---

## Task 14: 수동 검증

**Files:** (없음 — 검증만)

- [ ] **Step 1: 서버 + 대시보드 dev 서버 기동**

Run (백그라운드): `cd apps/server && bun run dev`
Run (백그라운드): `cd apps/dashboard && bun run dev`

- [ ] **Step 2: 서버 로그로 새 테이블이 붙었는지 확인**

Run: `sqlite3 <dbPath> ".schema notification_log"` (dev DB 경로는 `apps/server/.env` 또는 `config.ts` 기본값 확인)
Expected: Task 1의 스키마와 일치

- [ ] **Step 3: 브라우저로 대시보드 `/notifications` 접속, 관리자 로그인 후 확인**

- 필터 바가 렌더링되고, KPI 카드 4개가 (데이터가 없으면 0%/–로) 표시되는지
- 실제로 채팅 메시지를 오프라인 상대에게 보내 웹 푸시를 하나 발생시키고, 페이지를 새로고침해 발송 로그 행이 뜨는지 (`발송상태: 성공`)
- 브라우저가 알림을 수신하면(권한 허용 + 서비스워커 활성 상태) 몇 초 뒤 새로고침 시 `수신여부`가 "수신함"으로 바뀌는지, `수신시각`/`지연`이 채워지는지

- [ ] **Step 4: 전체 서버 테스트 스위트 + 앱 테스트 스위트 재확인**

Run: `cd apps/server && bun test`
Run: `cd apps/app && bunx jest`
Expected: 둘 다 PASS

- [ ] **Step 5: 이 태스크는 커밋할 코드 변경이 없다 (검증 전용) — 문제 발견 시 해당 태스크로 돌아가 수정 후 그 태스크의 커밋을 새로 만든다.**

---

## Self-Review Notes

- **스펙 커버리지**: 발송 로그(Task 1, 4, 5) / 클라이언트 ACK(Task 2, 6, 9, 10) / Expo 영수증 영속화(Task 3, 5) / 대시보드 API+페이지(Task 7, 11–13) / 명시된 플랫폼 한계 고지(Task 10 주석) — 스펙의 모든 섹션에 대응하는 태스크가 있다.
- **타입 일관성**: `notification_log.id` → 서버 `NotificationLogRow.id` / 페이로드 `n` / 클라이언트 `data.n` / `pushAckSchema.n` — 이름이 태스크 전체에서 `n`(전송) / `id`(저장)으로 일관된다. `PushService`/`ExpoPushService` 생성자 시그니처는 Task 4·5에서 바뀌고 Task 8에서 그 변경을 전제로 배선한다.
- **위험 지점**: Task 6·7은 Task 8(app.ts 배선) 전까지 컴파일이 깨진 중간 상태다 — 계획대로 Task 8까지 이어서 진행하고 그 지점에서 한 번에 커밋한다(각 태스크 Step에 명시).
