/**
 * 채팅 서비스 — 메시지 전송/조회/읽음 처리의 비즈니스 로직
 *
 * 전송 흐름:
 *   1. 참여자 검증 → 2. 내용 검증 → 3. SQLite 저장
 *   4. 상대방 + 내 다른 기기로 WS 팬아웃
 *   5. 상대가 오프라인이면 오프라인 훅 호출 (푸시 알림 발송)
 */
import type { ConversationSummary, MessageKind, PublicUser, WireMessage } from '@litechat/types';
import { MAX_MESSAGE_LENGTH } from '@litechat/types';
import type { WSContext } from 'hono/ws';
import type { AppDeps } from '../../deps';
import { errors } from '../../errors';
import { UsersRepo } from '../auth/repo';
import { ImagesRepo } from '../images/repo';
import { SafetyRepo } from '../safety/repo';
import { ConversationsRepo, type ConversationRow } from './conversations-repo';
import { MessagesRepo } from './messages-repo';

/**
 * 대화 목록의 마지막 메시지 미리보기 최대 글자 수.
 * 세 클라이언트 모두 한 줄로 잘라 보여주므로 이보다 길 필요가 없다.
 */
const PREVIEW_MAX_CHARS = 100;

/** 상대가 오프라인일 때 호출되는 훅 — 푸시 모듈이 구현을 주입한다 */
export type OfflineMessageHook = (peerId: number, sender: PublicUser, message: WireMessage) => void;

export class ChatService {
  private conversations: ConversationsRepo;
  private messages: MessagesRepo;
  private images: ImagesRepo;
  private users: UsersRepo;
  private safety: SafetyRepo;

  constructor(
    private deps: AppDeps,
    /** 상대 오프라인 시 알림 훅 (선택) */
    private onOfflinePeer?: OfflineMessageHook,
  ) {
    this.conversations = new ConversationsRepo(deps.db);
    this.messages = new MessagesRepo(deps.db);
    this.images = new ImagesRepo(deps.db);
    this.users = new UsersRepo(deps.db);
    this.safety = new SafetyRepo(deps.db);
  }

  /** 대화방 조회 + 참여자 검증. 통과하면 [대화방, 상대방 ID]를 반환한다. */
  private requireMembership(meId: number, conversationId: number): [ConversationRow, number] {
    const conversation = this.conversations.findById(conversationId);
    if (!conversation) throw errors.notFound();
    const peerId = this.conversations.peerOf(conversation, meId);
    if (peerId === null) throw errors.forbidden();
    if (this.safety.isBlockedEitherWay(meId, peerId)) throw errors.forbidden();
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
    /** 답장 대상 메시지 ID (선택) */
    replyToId?: number,
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

    // 답장 대상은 반드시 같은 대화 안의 메시지여야 한다.
    // 다른 대화의 ID를 인용하면 그 본문이 getMessages의 refs를 타고 새어 나가므로
    // 저장 전에 여기서 막는다.
    if (replyToId !== undefined) {
      const target = this.messages.findWire(replyToId);
      if (!target || target.c !== conversationId) throw errors.badRequest('INVALID_REPLY');
    }

    const message = this.messages.insert(conversationId, meId, kind, trimmed, replyToId);

    // 실시간 팬아웃: 상대방의 모든 기기 + 내 다른 기기.
    // 같은 프레임이므로 직렬화는 한 번만 한다 (전송마다 stringify 2회 → 1회).
    const payload = JSON.stringify({ t: 'm' as const, ...message });
    const peerOnline = this.deps.hub.sendPayload(peerId, payload);
    this.deps.hub.sendPayload(meId, payload, excludeSocket);

    // 상대가 완전히 오프라인이면 푸시 알림 훅 호출.
    // 온라인이라 푸시를 건너뛴 경우는 로그를 남기지 않는다 — 메시지 하나마다 stdout
    // 쓰기가 발생해 서비스에서 가장 뜨거운 경로에 동기 I/O를 얹는 데다,
    // 컨테이너 로그도 대화량에 비례해 불어난다.
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
      unread: number;
      peer_read: number;
      last_message_id: number | null;
      last_sender_id: number | null;
      last_kind: MessageKind | null;
      last_content: string | null;
      last_ts: number | null;
      img_width: number | null;
      img_height: number | null;
      img_webp_bytes: number | null;
      img_orig_bytes: number | null;
    }
    /**
     * 마지막 메시지까지 한 번의 쿼리로 가져온다.
     *
     * 이전에는 목록 쿼리로 last_id만 받고 대화마다 messages.findWire()를 한 번씩 더
     * 호출했다 — 대화가 N개면 쿼리가 1 + N개(전형적인 N+1). 채팅 탭은 앱을 열 때마다,
     * 재연결할 때마다 호출되는 경로라 대화 수에 비례해 비용이 늘었다.
     */
    const rows = this.deps.db
      .query<SummaryRow, [number, number, number, number, number, number, number, number]>(
        `SELECT c.id,
                u.id AS peer_id, u.username, u.nickname,
                (SELECT COUNT(*) FROM messages m
                  WHERE m.conversation_id = c.id
                    AND m.id > COALESCE(r.last_read_message_id, 0)
                    AND m.sender_id <> ?) AS unread,
                COALESCE(pr.last_read_message_id, 0) AS peer_read,
                last.id         AS last_message_id,
                last.sender_id  AS last_sender_id,
                last.kind       AS last_kind,
                -- 목록의 last는 세 클라이언트 모두 "미리보기 한 줄"로만 쓴다(CSS로 잘라 표시).
                -- 본문 전체를 실어 보내면 누군가 2,000자 메시지를 보낸 순간부터 두 참여자의
                -- 대화 목록 요청마다 그 6 KB가 영원히 따라다닌다. 앱 실행·재연결마다 오는
                -- 요청이라 저속 회선에서 특히 손해다. 미리보기 길이로 잘라 상한을 둔다
                -- (실제 메시지 본문은 /messages와 WS 프레임이 항상 완전한 형태로 전달한다).
                substr(last.content, 1, ?) AS last_content,
                last.created_at AS last_ts,
                i.width         AS img_width,
                i.height        AS img_height,
                i.webp_bytes    AS img_webp_bytes,
                i.orig_bytes    AS img_orig_bytes
         FROM conversations c
         JOIN users u ON u.id = CASE WHEN c.user_a = ? THEN c.user_b ELSE c.user_a END
         LEFT JOIN message_reads r ON r.conversation_id = c.id AND r.user_id = ?
         LEFT JOIN message_reads pr ON pr.conversation_id = c.id AND pr.user_id = u.id
         LEFT JOIN messages last ON last.id =
           (SELECT MAX(m.id) FROM messages m WHERE m.conversation_id = c.id)
         LEFT JOIN images i ON last.kind = 'i' AND i.id = last.content
         WHERE (c.user_a = ? OR c.user_b = ?)
           AND NOT EXISTS (
             SELECT 1 FROM user_blocks b
             WHERE (b.blocker_id = ? AND b.blocked_id = u.id)
                OR (b.blocker_id = u.id AND b.blocked_id = ?)
           )
         ORDER BY COALESCE(last.id, 0) DESC, c.id DESC`,
      )
      .all(meId, PREVIEW_MAX_CHARS, meId, meId, meId, meId, meId, meId);

    return rows.map((row) => ({
      id: row.id,
      peer: { id: row.peer_id, username: row.username, nickname: row.nickname },
      last: lastMessageOf(row),
      unread: row.unread,
      peerRead: row.peer_read,
    }));
  }
}

/** listConversations 조인 결과의 마지막 메시지 컬럼을 WireMessage로 옮긴다. */
function lastMessageOf(row: {
  id: number;
  last_message_id: number | null;
  last_sender_id: number | null;
  last_kind: MessageKind | null;
  last_content: string | null;
  last_ts: number | null;
  img_width: number | null;
  img_height: number | null;
  img_webp_bytes: number | null;
  img_orig_bytes: number | null;
}): WireMessage | null {
  if (row.last_message_id === null) return null;
  const message: WireMessage = {
    id: row.last_message_id,
    c: row.id,
    s: row.last_sender_id!,
    k: row.last_kind!,
    x: row.last_content!,
    ts: row.last_ts!,
  };
  if (row.last_kind === 'i' && row.img_width !== null) {
    message.im = {
      id: row.last_content!,
      w: row.img_width,
      h: row.img_height ?? 0,
      tb: row.img_webp_bytes ?? 0,
      ob: row.img_orig_bytes ?? 0,
    };
  }
  return message;
}
