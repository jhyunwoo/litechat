/**
 * conversations 테이블 저장소
 *
 * 1:1 대화방은 (user_a < user_b)로 정규화된 쌍으로 저장된다.
 * 친구 요청 수락 시 생성되고, 이후 삭제되지 않는다.
 */
import type { Database } from 'bun:sqlite';

export interface ConversationRow {
  id: number;
  user_a: number;
  user_b: number;
}

export class ConversationsRepo {
  constructor(private db: Database) {}

  /** 두 사용자 쌍의 대화방을 만들고 ID를 반환한다. 이미 있으면 기존 ID. */
  createForPair(userX: number, userY: number): number {
    const [a, b] = userX < userY ? [userX, userY] : [userY, userX];
    const existing = this.findByPair(a, b);
    if (existing) return existing.id;
    const result = this.db
      .query('INSERT INTO conversations (user_a, user_b, created_at) VALUES (?, ?, ?)')
      .run(a, b, Math.floor(Date.now() / 1000));
    return Number(result.lastInsertRowid);
  }

  /** 정규화된 쌍으로 조회 */
  findByPair(a: number, b: number): ConversationRow | null {
    return this.db
      .query<ConversationRow, [number, number]>(
        'SELECT id, user_a, user_b FROM conversations WHERE user_a = ? AND user_b = ?',
      )
      .get(a, b);
  }

  /** ID로 조회 */
  findById(id: number): ConversationRow | null {
    return this.db
      .query<ConversationRow, [number]>(
        'SELECT id, user_a, user_b FROM conversations WHERE id = ?',
      )
      .get(id);
  }

  /** 해당 사용자가 참여자인지 확인하고 상대방 ID를 반환한다. 아니면 null. */
  peerOf(conversation: ConversationRow, userId: number): number | null {
    if (conversation.user_a === userId) return conversation.user_b;
    if (conversation.user_b === userId) return conversation.user_a;
    return null;
  }
}
