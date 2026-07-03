/**
 * 채팅 서비스 — 메시지 전송/조회/읽음 처리의 비즈니스 로직
 *
 * 전송 흐름:
 *   1. 참여자 검증 → 2. 내용 검증 → 3. SQLite 저장
 *   4. 상대방 + 내 다른 기기로 WS 팬아웃
 *   5. 상대가 오프라인이면 오프라인 훅 호출 (푸시 알림 발송)
 */
import type {
  ConversationSummary,
  MessageKind,
  PublicUser,
  WireMessage,
} from '@litechat/types';
import { MAX_MESSAGE_LENGTH } from '@litechat/types';
import type { WSContext } from 'hono/ws';
import type { AppDeps } from '../../deps';
import { errors } from '../../errors';
import { UsersRepo } from '../auth/repo';
import { ImagesRepo } from '../images/repo';
import { ConversationsRepo, type ConversationRow } from './conversations-repo';
import { MessagesRepo } from './messages-repo';

/** 상대가 오프라인일 때 호출되는 훅 — 푸시 모듈이 구현을 주입한다 */
export type OfflineMessageHook = (peerId: number, sender: PublicUser, message: WireMessage) => void;

export class ChatService {
  private conversations: ConversationsRepo;
  private messages: MessagesRepo;
  private images: ImagesRepo;
  private users: UsersRepo;

  constructor(
    private deps: AppDeps,
    /** 상대 오프라인 시 알림 훅 (선택) */
    private onOfflinePeer?: OfflineMessageHook,
  ) {
    this.conversations = new ConversationsRepo(deps.db);
    this.messages = new MessagesRepo(deps.db);
    this.images = new ImagesRepo(deps.db);
    this.users = new UsersRepo(deps.db);
  }

  /** 대화방 조회 + 참여자 검증. 통과하면 [대화방, 상대방 ID]를 반환한다. */
  private requireMembership(meId: number, conversationId: number): [ConversationRow, number] {
    const conversation = this.conversations.findById(conversationId);
    if (!conversation) throw errors.notFound();
    const peerId = this.conversations.peerOf(conversation, meId);
    if (peerId === null) throw errors.forbidden();
    return [conversation, peerId];
  }

  /** 메시지 전송 — REST와 WS 양쪽에서 호출된다. */
  sendMessage(
    meId: number,
    conversationId: number,
    kind: MessageKind,
    content: string,
    /** WS 전송 시 본인 소켓 (팬아웃에서 제외하고 ack만 받게 한다) */
    excludeSocket?: WSContext,
  ): WireMessage {
    const [, peerId] = this.requireMembership(meId, conversationId);

    // 내용 검증 — 종류별 규칙
    const trimmed = content.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_MESSAGE_LENGTH) {
      throw errors.badRequest('INVALID_CONTENT');
    }
    if (kind === 'i') {
      // 이미지 메시지는 본인이 업로드한 이미지 ID여야 한다.
      const image = this.images.findById(trimmed);
      if (!image || image.owner_id !== meId) throw errors.badRequest('INVALID_IMAGE');
    }

    const message = this.messages.insert(conversationId, meId, kind, trimmed);

    // 실시간 팬아웃: 상대방의 모든 기기 + 내 다른 기기
    const frame = { t: 'm' as const, ...message };
    const peerOnline = this.deps.hub.sendToUser(peerId, frame);
    this.deps.hub.sendToUser(meId, frame, excludeSocket);

    // 상대가 완전히 오프라인이면 푸시 알림 훅 호출
    if (!peerOnline && this.onOfflinePeer) {
      const sender = this.users.findPublicById(meId)!;
      this.onOfflinePeer(peerId, sender, message);
    }

    return message;
  }

  /** 메시지 목록 조회 */
  getMessages(
    meId: number,
    conversationId: number,
    options: { after?: number; before?: number; limit: number },
  ): WireMessage[] {
    this.requireMembership(meId, conversationId);
    return this.messages.list(conversationId, options);
  }

  /** 읽음 워터마크 전진 + 상대방에게 실시간 알림 */
  markRead(meId: number, conversationId: number, messageId: number): { watermark: number } {
    const [, peerId] = this.requireMembership(meId, conversationId);

    const previous = this.messages.getWatermark(conversationId, meId);
    const watermark = this.messages.advanceWatermark(conversationId, meId, messageId);

    // 실제로 전진했을 때만 알림을 보내 불필요한 프레임을 줄인다.
    if (watermark > previous) {
      this.deps.hub.sendToUser(peerId, { t: 'r', c: conversationId, u: meId, m: watermark });
    }
    return { watermark };
  }

  /** 채팅 탭용 대화 목록 — 상대/마지막 메시지/안읽음 수/상대 워터마크 */
  listConversations(meId: number): ConversationSummary[] {
    interface SummaryRow {
      id: number;
      peer_id: number;
      username: string;
      nickname: string;
      last_id: number | null;
      unread: number;
      peer_read: number;
    }
    const rows = this.deps.db
      .query<SummaryRow, [number, number, number, number, number]>(
        `SELECT c.id,
                u.id AS peer_id, u.username, u.nickname,
                (SELECT MAX(m.id) FROM messages m WHERE m.conversation_id = c.id) AS last_id,
                (SELECT COUNT(*) FROM messages m
                  WHERE m.conversation_id = c.id
                    AND m.id > COALESCE(r.last_read_message_id, 0)
                    AND m.sender_id <> ?) AS unread,
                COALESCE(pr.last_read_message_id, 0) AS peer_read
         FROM conversations c
         JOIN users u ON u.id = CASE WHEN c.user_a = ? THEN c.user_b ELSE c.user_a END
         LEFT JOIN message_reads r ON r.conversation_id = c.id AND r.user_id = ?
         LEFT JOIN message_reads pr ON pr.conversation_id = c.id AND pr.user_id = u.id
         WHERE c.user_a = ? OR c.user_b = ?
         ORDER BY COALESCE(last_id, 0) DESC, c.id DESC`,
      )
      .all(meId, meId, meId, meId, meId);

    return rows.map((row) => ({
      id: row.id,
      peer: { id: row.peer_id, username: row.username, nickname: row.nickname },
      last: row.last_id !== null ? this.messages.findWire(row.last_id) : null,
      unread: row.unread,
      peerRead: row.peer_read,
    }));
  }
}
