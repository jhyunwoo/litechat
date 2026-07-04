/**
 * expo_push_tokens 테이블 저장소
 */
import type { Database } from 'bun:sqlite';

/** 사용자당 보관하는 최대 토큰 수 — 초과분은 오래된 것부터 삭제한다 (남용 방지) */
const MAX_TOKENS_PER_USER = 10;

export interface ExpoPushTokenRow {
  id: number;
  user_id: number;
  token: string;
}

export class ExpoPushRepo {
  constructor(private db: Database) {}

  /**
   * 토큰 등록 — 같은 토큰이 다시 오면 소유자를 갱신한다.
   * (토큰은 기기 단위이므로, 같은 기기에서 다른 계정으로 로그인하면 재할당된다)
   */
  upsert(userId: number, token: string): void {
    this.db
      .query(
        `INSERT INTO expo_push_tokens (user_id, token, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT (token) DO UPDATE SET user_id = excluded.user_id`,
      )
      .run(userId, token, Math.floor(Date.now() / 1000));
    // 사용자당 토큰 수 상한 — 초과분은 오래된 것부터 정리한다.
    this.db
      .query(
        `DELETE FROM expo_push_tokens
         WHERE user_id = ?
           AND id NOT IN (
             SELECT id FROM expo_push_tokens WHERE user_id = ?
             ORDER BY id DESC LIMIT ?
           )`,
      )
      .run(userId, userId, MAX_TOKENS_PER_USER);
  }

  /** 사용자의 모든 기기 토큰 */
  listByUser(userId: number): ExpoPushTokenRow[] {
    return this.db
      .query<ExpoPushTokenRow, [number]>(
        'SELECT id, user_id, token FROM expo_push_tokens WHERE user_id = ?',
      )
      .all(userId);
  }

  /** 본인 소유 토큰만 삭제 (알림 끄기) — 남의 토큰은 지울 수 없다 */
  deleteForUser(userId: number, token: string): void {
    this.db.query('DELETE FROM expo_push_tokens WHERE user_id = ? AND token = ?').run(userId, token);
  }

  /** 토큰으로 삭제 (DeviceNotRegistered 등 만료 정리) */
  deleteByToken(token: string): void {
    this.db.query('DELETE FROM expo_push_tokens WHERE token = ?').run(token);
  }

  /** 사용자의 전체 안읽음 수 — 알림 배지(badge)용 (listConversations의 unread 규칙과 동일) */
  countUnread(userId: number): number {
    const row = this.db
      .query<{ total: number }, [number, number, number, number]>(
        `SELECT COUNT(*) AS total
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         LEFT JOIN message_reads r ON r.conversation_id = c.id AND r.user_id = ?
         WHERE (c.user_a = ? OR c.user_b = ?)
           AND m.sender_id <> ?
           AND m.id > COALESCE(r.last_read_message_id, 0)`,
      )
      .get(userId, userId, userId, userId);
    return row?.total ?? 0;
  }
}
