/**
 * push_subscriptions 테이블 저장소
 */
import type { Database } from 'bun:sqlite';

export interface PushSubscriptionRow {
  id: number;
  user_id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export class PushRepo {
  constructor(private db: Database) {}

  /** 구독 등록 — 같은 endpoint가 다시 오면 소유자/키를 갱신한다 (기기 재구독). */
  upsert(userId: number, endpoint: string, p256dh: string, auth: string): void {
    this.db
      .query(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id,
           p256dh = excluded.p256dh, auth = excluded.auth`,
      )
      .run(userId, endpoint, p256dh, auth, Math.floor(Date.now() / 1000));
  }

  /** 사용자의 모든 기기 구독 */
  listByUser(userId: number): PushSubscriptionRow[] {
    return this.db
      .query<PushSubscriptionRow, [number]>(
        'SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
      )
      .all(userId);
  }

  /** 사용자가 소유한 endpoint만 해지 */
  deleteForUser(userId: number, endpoint: string): void {
    this.db
      .query('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
      .run(userId, endpoint);
  }

  /** 제공자가 만료로 판정한 endpoint 정리 (내부 발송 경로 전용) */
  deleteByEndpoint(endpoint: string): void {
    this.db.query('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  }
}
