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
