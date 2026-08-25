import type { BlockedUser, ContentReportInput } from '@litechat/types';
import type { Database } from 'bun:sqlite';

export interface ContentReportRow {
  id: number;
  reporterId: number;
  reportedUserId: number;
  messageId: number | null;
  reason: ContentReportInput['reason'];
  details: string | null;
  status: 'open' | 'reviewed' | 'dismissed' | 'actioned';
  createdAt: number;
  resolvedAt: number | null;
  reporterUsername: string;
  reportedUsername: string;
  messageKind: string | null;
  messageContent: string | null;
}

export class SafetyRepo {
  constructor(private db: Database) {}

  isBlockedEitherWay(userA: number, userB: number): boolean {
    return Boolean(
      this.db
        .query<{ found: number }, [number, number, number, number]>(
          `SELECT 1 AS found FROM user_blocks
           WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
           LIMIT 1`,
        )
        .get(userA, userB, userB, userA),
    );
  }

  block(blockerId: number, blockedId: number): void {
    this.db
      .query(
        `INSERT INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)
         ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
      )
      .run(blockerId, blockedId, Math.floor(Date.now() / 1000));
  }

  unblock(blockerId: number, blockedId: number): void {
    this.db
      .query('DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?')
      .run(blockerId, blockedId);
  }

  listBlocked(blockerId: number): BlockedUser[] {
    return this.db
      .query<{ id: number; username: string; nickname: string; ts: number }, [number]>(
        `SELECT u.id, u.username, u.nickname, b.created_at AS ts
         FROM user_blocks b JOIN users u ON u.id = b.blocked_id
         WHERE b.blocker_id = ? ORDER BY b.created_at DESC`,
      )
      .all(blockerId)
      .map((row) => ({
        user: { id: row.id, username: row.username, nickname: row.nickname },
        ts: row.ts,
      }));
  }

  /** 신고 메시지는 신고자가 참여한 대화의 상대가 작성한 경우에만 근거로 사용할 수 있다. */
  canReferenceMessage(reporterId: number, reportedUserId: number, messageId: number): boolean {
    return Boolean(
      this.db
        .query<{ found: number }, [number, number, number, number]>(
          `SELECT 1 AS found FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
           WHERE m.id = ? AND m.sender_id = ? AND (c.user_a = ? OR c.user_b = ?)
           LIMIT 1`,
        )
        .get(messageId, reportedUserId, reporterId, reporterId),
    );
  }

  report(reporterId: number, input: ContentReportInput): number {
    const result = this.db
      .query(
        `INSERT INTO content_reports
           (reporter_id, reported_user_id, message_id, reason, details, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        reporterId,
        input.userId,
        input.messageId ?? null,
        input.reason,
        input.details?.trim() || null,
        Math.floor(Date.now() / 1000),
      );
    return Number(result.lastInsertRowid);
  }

  listReports(status?: string): ContentReportRow[] {
    const rows = this.db
      .query<ContentReportRow, string[]>(
        `SELECT r.id, r.reporter_id AS reporterId, r.reported_user_id AS reportedUserId,
                r.message_id AS messageId, r.reason, r.details, r.status,
                r.created_at AS createdAt, r.resolved_at AS resolvedAt,
                reporter.username AS reporterUsername, reported.username AS reportedUsername,
                m.kind AS messageKind, m.content AS messageContent
         FROM content_reports r
         JOIN users reporter ON reporter.id = r.reporter_id
         JOIN users reported ON reported.id = r.reported_user_id
         LEFT JOIN messages m ON m.id = r.message_id
         ${status ? 'WHERE r.status = ?' : ''}
         ORDER BY r.created_at ASC`,
      )
      .all(...(status ? [status] : []));
    return rows;
  }

  resolveReport(id: number, status: 'reviewed' | 'dismissed' | 'actioned'): boolean {
    return (
      this.db
        .query('UPDATE content_reports SET status = ?, resolved_at = ? WHERE id = ?')
        .run(status, Math.floor(Date.now() / 1000), id).changes > 0
    );
  }
}
