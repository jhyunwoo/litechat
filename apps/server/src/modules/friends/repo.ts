/**
 * friendships 테이블 저장소
 */
import type { Database } from 'bun:sqlite';
import type { FriendshipStatus, PublicUser } from '@litechat/types';

export interface FriendshipRow {
  id: number;
  requester_id: number;
  addressee_id: number;
  status: FriendshipStatus;
}

/** 요청 목록 조회 결과 (상대방 정보 포함) */
export interface RequestWithUser {
  id: number;
  ts: number;
  user: PublicUser;
}

export class FriendsRepo {
  constructor(private db: Database) {}

  /** 친구 요청 생성 — 쌍 중복이면 SQLite UNIQUE 오류가 발생한다. */
  insertRequest(requesterId: number, addresseeId: number): number {
    const result = this.db
      .query(
        `INSERT INTO friendships (requester_id, addressee_id, status, created_at)
         VALUES (?, ?, 'pending', ?)`,
      )
      .run(requesterId, addresseeId, Math.floor(Date.now() / 1000));
    return Number(result.lastInsertRowid);
  }

  findById(id: number): FriendshipRow | null {
    return this.db
      .query<FriendshipRow, [number]>(
        'SELECT id, requester_id, addressee_id, status FROM friendships WHERE id = ?',
      )
      .get(id);
  }

  /** 방향과 무관하게 두 사용자 간의 관계를 조회한다. */
  findBetween(userX: number, userY: number): FriendshipRow | null {
    return this.db
      .query<FriendshipRow, [number, number, number, number]>(
        `SELECT id, requester_id, addressee_id, status FROM friendships
         WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
      )
      .get(userX, userY, userY, userX);
  }

  /** 요청 수락 */
  markAccepted(id: number): void {
    this.db.query(`UPDATE friendships SET status = 'accepted' WHERE id = ?`).run(id);
  }

  /** 요청 거절/삭제 — 행을 지워 재요청을 허용한다. */
  delete(id: number): void {
    this.db.query('DELETE FROM friendships WHERE id = ?').run(id);
  }

  /** 내가 받은 대기중 요청 (최신순) */
  listIncoming(userId: number): RequestWithUser[] {
    return this.listRequests(userId, 'addressee_id', 'requester_id');
  }

  /** 내가 보낸 대기중 요청 (최신순) */
  listOutgoing(userId: number): RequestWithUser[] {
    return this.listRequests(userId, 'requester_id', 'addressee_id');
  }

  /** incoming/outgoing 공통 쿼리 — meColumn이 나, otherColumn이 상대방 */
  private listRequests(
    userId: number,
    meColumn: 'requester_id' | 'addressee_id',
    otherColumn: 'requester_id' | 'addressee_id',
  ): RequestWithUser[] {
    const rows = this.db
      .query<
        { id: number; ts: number; user_id: number; username: string; nickname: string },
        [number]
      >(
        `SELECT f.id, f.created_at AS ts, u.id AS user_id, u.username, u.nickname
         FROM friendships f JOIN users u ON u.id = f.${otherColumn}
         WHERE f.${meColumn} = ? AND f.status = 'pending'
         ORDER BY f.id DESC`,
      )
      .all(userId);
    return rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      user: { id: r.user_id, username: r.username, nickname: r.nickname },
    }));
  }

  /** 수락된 친구 목록 (아이디 오름차순) */
  listFriends(userId: number): PublicUser[] {
    return this.db
      .query<PublicUser, [number, number, number]>(
        `SELECT u.id, u.username, u.nickname
         FROM friendships f
         JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
         WHERE (f.requester_id = ? OR f.addressee_id = ?) AND f.status = 'accepted'
         ORDER BY u.username ASC`,
      )
      .all(userId, userId, userId);
  }
}
