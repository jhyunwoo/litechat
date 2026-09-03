/**
 * messages / message_reads 테이블 저장소
 *
 * 메시지 행을 WireMessage(짧은 키)로 변환하는 책임도 여기에 둔다.
 * 이미지 메시지는 images 테이블을 LEFT JOIN하여 메타데이터(im)를 붙인다.
 */
import type { Database } from 'bun:sqlite';
import type { MessageKind, WireMessage, WireQuote } from '@litechat/types';

/** JOIN 결과 행 (이미지 메타 포함 가능) */
interface MessageJoinRow {
  id: number;
  conversation_id: number;
  sender_id: number;
  kind: MessageKind;
  content: string;
  created_at: number;
  img_width: number | null;
  img_height: number | null;
  img_webp_bytes: number | null;
  img_orig_bytes: number | null;
  reply_to_id: number | null;
}

/** 이미지 메타 조인을 포함한 SELECT 공통 부분 */
const SELECT_WITH_IMAGE = `
  SELECT m.id, m.conversation_id, m.sender_id, m.kind, m.content, m.created_at, m.reply_to_id,
         i.width AS img_width, i.height AS img_height,
         i.webp_bytes AS img_webp_bytes, i.orig_bytes AS img_orig_bytes
  FROM messages m
  LEFT JOIN images i ON m.kind = 'i' AND i.id = m.content
`;

/**
 * 인용 미리보기 본문 최대 길이 (문자).
 * 클라이언트는 인용문을 한 줄로만 표시하므로 이보다 길 필요가 없다.
 * service.ts의 PREVIEW_MAX_CHARS와 같은 이유로 서버 안에 둔다 — 클라이언트가 쓰지도
 * 않는 상수를 공유 패키지에 두면 세 프론트엔드 번들에 그대로 딸려 들어간다.
 */
const QUOTE_MAX_CHARS = 100;

/** DB 행 → 와이어 포맷 변환 */
function toWire(row: MessageJoinRow): WireMessage {
  const wire: WireMessage = {
    id: row.id,
    c: row.conversation_id,
    s: row.sender_id,
    k: row.kind,
    x: row.content,
    ts: row.created_at,
  };
  if (row.reply_to_id !== null) wire.r = row.reply_to_id;
  if (row.kind === 'i' && row.img_width !== null) {
    wire.im = {
      id: row.content,
      w: row.img_width,
      h: row.img_height ?? 0,
      tb: row.img_webp_bytes ?? 0,
      ob: row.img_orig_bytes ?? 0,
    };
  }
  return wire;
}

export class MessagesRepo {
  constructor(private db: Database) {}

  /** 메시지 저장 후 와이어 포맷으로 반환. replyToId가 있으면 답장으로 기록한다. */
  insert(
    conversationId: number,
    senderId: number,
    kind: MessageKind,
    content: string,
    replyToId?: number,
  ): WireMessage {
    const ts = Math.floor(Date.now() / 1000);
    const result = this.db
      .query(
        `INSERT INTO messages (conversation_id, sender_id, kind, content, created_at, reply_to_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(conversationId, senderId, kind, content, ts, replyToId ?? null);
    const id = Number(result.lastInsertRowid);
    return this.findWire(id)!;
  }

  /**
   * 인용 표시용 축약 조회 — 답장이 가리키는 원본을 한 줄 미리보기로만 가져온다.
   *
   * conversation_id 조건이 보안 경계다. 이게 없으면 남의 대화 메시지 ID를 찍어
   * 본문 앞 100자를 긁어낼 수 있다. 절대 빼지 말 것.
   */
  listQuotes(conversationId: number, ids: number[]): WireQuote[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return this.db
      .query<{ id: number; sender_id: number; kind: MessageKind; content: string }, number[]>(
        `SELECT m.id, m.sender_id, m.kind, substr(m.content, 1, ?) AS content
         FROM messages m
         WHERE m.conversation_id = ? AND m.id IN (${placeholders})`,
      )
      .all(QUOTE_MAX_CHARS, conversationId, ...ids)
      .map((row) => ({ id: row.id, s: row.sender_id, k: row.kind, x: row.content }));
  }

  /** 단일 메시지를 와이어 포맷으로 조회 */
  findWire(id: number): WireMessage | null {
    const row = this.db
      .query<MessageJoinRow, [number]>(`${SELECT_WITH_IMAGE} WHERE m.id = ?`)
      .get(id);
    return row ? toWire(row) : null;
  }

  /**
   * 메시지 목록 조회 (항상 오름차순 반환)
   * - after: 해당 ID 이후 전체 (재접속 catch-up)
   * - before: 해당 ID 이전에서 최신 limit개 (과거 페이지네이션)
   * - 둘 다 없으면: 최신 limit개
   */
  list(
    conversationId: number,
    options: { after?: number; before?: number; limit: number },
  ): WireMessage[] {
    let rows: MessageJoinRow[];
    if (options.after !== undefined) {
      rows = this.db
        .query<MessageJoinRow, [number, number, number]>(
          `${SELECT_WITH_IMAGE} WHERE m.conversation_id = ? AND m.id > ? ORDER BY m.id ASC LIMIT ?`,
        )
        .all(conversationId, options.after, options.limit);
    } else {
      // 최신 쪽에서 limit개를 뽑은 뒤 오름차순으로 뒤집는다.
      const beforeCondition = options.before !== undefined ? 'AND m.id < ?' : '';
      const params: number[] = [conversationId];
      if (options.before !== undefined) params.push(options.before);
      params.push(options.limit);
      rows = this.db
        .query<MessageJoinRow, number[]>(
          `${SELECT_WITH_IMAGE} WHERE m.conversation_id = ? ${beforeCondition}
           ORDER BY m.id DESC LIMIT ?`,
        )
        .all(...params)
        .reverse();
    }
    return rows.map(toWire);
  }

  /** 읽음 워터마크 조회 (없으면 0) */
  getWatermark(conversationId: number, userId: number): number {
    const row = this.db
      .query<{ last_read_message_id: number }, [number, number]>(
        'SELECT last_read_message_id FROM message_reads WHERE conversation_id = ? AND user_id = ?',
      )
      .get(conversationId, userId);
    return row?.last_read_message_id ?? 0;
  }

  /**
   * 읽음 워터마크 전진 — MAX를 사용해 절대 뒤로 가지 않는다.
   * @returns 갱신 후 워터마크 값
   */
  advanceWatermark(conversationId: number, userId: number, messageId: number): number {
    this.db
      .query(
        `INSERT INTO message_reads (conversation_id, user_id, last_read_message_id)
         VALUES (?, ?, ?)
         ON CONFLICT (conversation_id, user_id)
         DO UPDATE SET last_read_message_id = MAX(last_read_message_id, excluded.last_read_message_id)`,
      )
      .run(conversationId, userId, messageId);
    return this.getWatermark(conversationId, userId);
  }
}
