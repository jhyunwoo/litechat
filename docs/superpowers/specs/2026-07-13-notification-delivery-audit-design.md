# 알림 발송/수신 추적 + 대시보드 설계

## 배경

앱(Expo Push)과 웹(Web Push)에서 알림이 실제로 잘 나가고 있는지 확인할 방법이 없다.
현재 구조를 점검한 결과:

- 발송 시도는 `console.log`로만 남고 DB에 영구 저장되지 않는다 — 재현/조회 불가.
- `ExpoPushService`의 "영수증"(APNs가 실제로 받았는지) 확인 결과는 인메모리 `Map`에만
  있어 서버 재시작 시 사라지고, 대시보드에서 볼 수 없다.
- 클라이언트가 알림을 실제로 받았다는 신호가 서버로 전혀 오지 않는다 — 웹 서비스워커의
  `push` 핸들러도, 앱의 알림 리스너도 수신 확인(ACK)을 보내지 않는다. 즉 지금 구조로는
  "보냈다"까지만 알 수 있고 "받았다"는 전혀 알 수 없다.

이 설계는 위 세 가지 공백을 메우고, 수집한 정보를 대시보드에서 조회할 수 있게 한다.

## 목표

- 웹/앱 채널 모두에서 알림 발송 시도를 영구 로그로 남긴다 (수신자, 채널, 발송 시각,
  발송 성공/실패/만료 여부, 실패 사유).
- Expo 영수증(APNs 접수 확인) 결과를 영속화한다.
- 클라이언트가 알림을 실제로 받았을 때 서버에 ACK를 보내 `수신 시각`을 기록한다
  (플랫폼 한계상 100% 보장은 불가능 — 아래 "한계" 참조).
- 대시보드에 새 페이지를 추가해 위 정보를 필터/정렬/페이지네이션으로 조회한다.

## 비목표

- 웹/앱 외 다른 알림 채널(이메일 등)은 없음 — 대상 아님.
- apps/lite는 푸시 알림 기능이 없음 — 대상 아님.
- 100% 정확한 수신 확인 보장 — 클라이언트 프로세스가 완전히 종료된 상태에서 온 알림은
  ACK가 원천적으로 불가능하다 (아래 한계 참조).

## 데이터 모델

새 테이블 `notification_log` (마이그레이션 v5→v6, `apps/server/src/db/migrations.ts`에 추가):

```sql
CREATE TABLE notification_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id),   -- 수신자
  channel        TEXT    NOT NULL CHECK (channel IN ('web', 'expo')),
  conversation_id INTEGER REFERENCES conversations(id),
  body_preview   TEXT    NOT NULL DEFAULT '',              -- 디버깅용 미리보기 (previewOf 결과)
  sent_at        INTEGER NOT NULL,
  sent_status    TEXT    NOT NULL CHECK (sent_status IN ('ok', 'error', 'expired')),
  sent_error     TEXT,                                     -- 실패 사유 (nullable)
  receipt_status TEXT    CHECK (receipt_status IN ('pending', 'ok', 'error')), -- expo 전용
  receipt_checked_at INTEGER,
  received_at    INTEGER,                                  -- 클라이언트 ACK 최초 도착 시각
  received_meta  TEXT                                      -- ACK 호출의 User-Agent 등 (선택)
);
CREATE INDEX ix_notification_log_user ON notification_log (user_id, sent_at);
CREATE INDEX ix_notification_log_sent ON notification_log (sent_at);
```

웹/앱을 하나의 테이블로 통합한다 (channel 컬럼으로 구분) — `analytics_sessions`가
web/lite/app을 `platform` 컬럼 하나로 묶는 기존 패턴과 동일. 채널별로 테이블을
나누면 대시보드에서 "이 사용자에게 보낸 모든 알림"을 조회할 때 조인이 필요해져
불필요하게 복잡해진다.

## 발송 → ACK 흐름

### 1. 발송 시 로그 기록 (서버)

`apps/server/src/modules/push/notification-log-repo.ts`에 `NotificationLogRepo` 신설.
메서드: `insert(...)`(sent_status='ok'로 즉시 기록), `markFailed(id, status, error)`,
`markReceived(id, userId, meta)`, `listPendingReceipts(olderThanMs)`,
`updateReceiptStatus(id, status)`, `list(filter)`, `summary(days)`.

`app.ts`에서 단일 인스턴스를 생성해 `PushService`, `ExpoPushService`, `adminRoutes`에
주입한다 (push 모듈이 테이블을 소유하고, admin 라우트는 `AdminRepo`를 직접 쓰는 기존
패턴처럼 `NotificationLogRepo`를 직접 읽기 전용으로 사용).

- `PushService.sendToUser`: 각 구독에 발송하기 직전 `insert()`로 행 생성 → 응답에 따라
  `ok`/`expired`(404/410)/`error`로 업데이트. 페이로드에 `n: logId` 필드 추가.
- `ExpoPushService.sendToUser`: 각 토큰에 발송 직전 `insert()` → 티켓 상태에 따라
  `ok`/`expired`(DeviceNotRegistered)/`error`로 업데이트. `data.n`에 logId 추가.
  기존 인메모리 `pendingReceipts` Map은 제거하고, `receipt_status='pending'`인 로그 행을
  조회하는 방식으로 대체한다 (`listPendingReceipts`).

### 2. 클라이언트 ACK

새 엔드포인트 `POST /api/push/ack` (`requireAuth`): body `{ n: number }`. 로그 행을 찾아
`user_id`가 요청자 본인인지 확인 후 `received_at`이 비어 있으면 현재 시각으로 채운다
(중복 ACK는 무시).

- **웹** (`apps/web/src/sw.ts`): `push` 이벤트 핸들러의 `event.waitUntil`에
  `fetch('/api/push/ack', { method: 'POST', body: JSON.stringify({ n: payload.n }) })`를
  `showNotification`과 나란히 추가. 같은 오리진 요청이라 `lc_sess` 쿠키가 자동으로
  실린다.
- **앱** (`apps/app/src/lib/notifications.ts`): `Notifications.addNotificationReceivedListener`를
  새로 등록해 `data.n`으로 ack 호출. 기존 `api` 클라이언트가 SecureStore의 Bearer
  토큰을 자동으로 붙인다.

### 3. Expo 영수증 확인 (영속화)

`checkPendingReceipts`가 `listPendingReceipts(15분)`으로 대상 조회 →
`EXPO_RECEIPTS_URL` 확인 → `receipt_status`/`receipt_checked_at` 업데이트,
`DeviceNotRegistered`면 기존처럼 토큰 정리.

### 한계 (우회 불가, 사용자 확인됨)

브라우저가 완전히 종료되었거나 iOS 앱이 강제 종료된 상태로 알림이 도착하면 ACK가
오지 않는다. `received_at`은 `NULL`로 남고, 대시보드에서는 24시간 경과 시
"미수신 추정"으로 표시한다. 이는 플랫폼(Web Push/APNs) 자체의 한계다.

## 관리자 API

`GET /api/admin/notifications` — `/sessions`와 동일한 필터/정렬/페이지네이션 패턴.

- 필터: `userId`, `channel`(web/expo), `sentStatus`(ok/error/expired),
  `receivedStatus`(received/pending/presumed_lost/n-a), `from`, `to`.
- 정렬: `sent_at` | `received_at`, `dir`.
- `receivedStatus`는 저장 컬럼이 아니라 조회 시 계산:
  - `sent_status ≠ 'ok'` → `n/a`
  - `received_at` 있음 → `received`
  - 없고 발송 후 24시간 미만 → `pending`
  - 없고 24시간 이상 → `presumed_lost`

`GET /api/admin/notifications/summary?days=30` — 상단 KPI 집계: 전체 발송,
상태별 건수(ok/error/expired), 수신 확인율, 평균 수신 지연(초).

## 대시보드 페이지

`apps/dashboard/src/pages/NotificationsPage.tsx`, 라우트 `/notifications`,
네비 탭 "알림 로그".

- 상단 KPI 카드 4개 (발송 건수/성공률/수신 확인율/평균 수신 지연) — `OverviewPage`의
  `KpiCard`를 `apps/dashboard/src/components/KpiCard.tsx`로 추출해 재사용(동작 변화
  없는 사소한 중복 제거).
- 필터 바(`SessionsPage`와 동일 스타일): 수신자, 채널, 발송상태, 수신상태, 기간.
- 정렬 가능한 테이블: 발송시각 · 수신자 · 채널 · 발송상태(실패 사유 title 툴팁) ·
  영수증상태(expo만, web은 "—") · 수신시각 · 수신여부 뱃지 · 수신지연(사람이 읽는
  형식) · 메시지 미리보기(truncate).
- 페이지네이션 50건/페이지 (기존 패턴과 동일).

`apps/dashboard/src/api.ts`에 타입(`NotificationLogRow`, `NotificationsResult`,
`NotificationsParams`, `NotificationSummary`)과 `adminApi.notifications()`,
`adminApi.notificationsSummary()` 추가. `App.tsx`에 라우트/탭 추가.

## 테스트

- `apps/server/src/modules/push/push.test.ts` / `expo.test.ts`: 발송 시 로그 생성 및
  상태 전이(ok/error/expired) 검증.
- ACK 엔드포인트: 본인 로그만 갱신되는지, 중복 ACK가 무시되는지, 타인 로그 ACK 시도가
  거부되는지 검증.
- 영수증 영속화가 인메모리 Map을 대체해 서버 재시작 시나리오에서도 동작하는지 검증
  (레포 레벨 테스트로 갈음).
- `NotificationLogRepo` 필터/정렬 테스트는 `analytics/repo.test.ts` 패턴을 따른다.
- 대시보드 페이지는 기존 페이지들처럼 별도 유닛테스트 없이 dev 서버로 수동 확인.
