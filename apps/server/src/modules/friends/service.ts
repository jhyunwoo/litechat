/**
 * 친구 서비스 — 검색/요청/수락/거절 비즈니스 로직
 *
 * 수락 시 대화방을 만들고, 관련 사용자에게 WebSocket으로 즉시 알린다.
 * (오프라인이면 다음 접속 시 REST 조회로 반영되므로 알림 유실은 문제없다)
 */
import type { PublicUser } from '@litechat/types';
import type { AppDeps } from '../../deps';
import { errors } from '../../errors';
import { UsersRepo } from '../auth/repo';
import { ConversationsRepo } from '../chat/conversations-repo';
import { FriendsRepo, type RequestWithUser } from './repo';

/** 검색 결과에 붙는 나와의 관계 상태 */
export type Relation = 'none' | 'self' | 'friends' | 'pending_out' | 'pending_in';

export interface SearchResult extends PublicUser {
  rel: Relation;
}

export class FriendsService {
  private users: UsersRepo;
  private friends: FriendsRepo;
  private conversations: ConversationsRepo;

  constructor(private deps: AppDeps) {
    this.users = new UsersRepo(deps.db);
    this.friends = new FriendsRepo(deps.db);
    this.conversations = new ConversationsRepo(deps.db);
  }

  /** 아이디 검색 — 각 결과에 나와의 관계(rel)를 붙여 UI가 버튼 상태를 결정하게 한다. */
  search(meId: number, query: string): SearchResult[] {
    return this.users.searchByUsername(query, 10).map((user) => {
      let rel: Relation = 'none';
      if (user.id === meId) {
        rel = 'self';
      } else {
        const existing = this.friends.findBetween(meId, user.id);
        if (existing?.status === 'accepted') rel = 'friends';
        else if (existing?.requester_id === meId) rel = 'pending_out';
        else if (existing) rel = 'pending_in';
      }
      return { ...user, rel };
    });
  }

  /** 친구 요청 전송 + 상대방에게 실시간 알림 */
  sendRequest(meId: number, targetUserId: number): { id: number } {
    if (meId === targetUserId) throw errors.badRequest('CANNOT_FRIEND_SELF');

    const target = this.users.findPublicById(targetUserId);
    if (!target) throw errors.notFound();

    if (this.friends.findBetween(meId, targetUserId)) throw errors.conflict('ALREADY_RELATED');

    const id = this.friends.insertRequest(meId, targetUserId);

    // 상대가 접속 중이면 즉시 요청 알림을 보낸다.
    const me = this.users.findPublicById(meId)!;
    this.deps.hub.sendToUser(targetUserId, { t: 'f', k: 'req', u: me });

    return { id };
  }

  /** 받은/보낸 대기중 요청 목록 */
  listRequests(meId: number): { incoming: RequestWithUser[]; outgoing: RequestWithUser[] } {
    return {
      incoming: this.friends.listIncoming(meId),
      outgoing: this.friends.listOutgoing(meId),
    };
  }

  /**
   * 요청 응답 — 수신자만 가능하다.
   * 수락: 상태 변경 + 대화방 생성 + 요청자에게 실시간 알림
   * 거절: 행 삭제 (재요청 허용)
   */
  respond(meId: number, requestId: number, accept: boolean): { conversationId: number | null } {
    const request = this.friends.findById(requestId);
    // 존재하지 않거나, 내가 수신자가 아니거나, 이미 처리된 요청은 404로 통일한다.
    // (권한 없는 사용자에게 요청의 존재 여부를 노출하지 않기 위함)
    if (!request || request.addressee_id !== meId || request.status !== 'pending') {
      throw errors.notFound();
    }

    if (!accept) {
      this.friends.delete(requestId);
      return { conversationId: null };
    }

    this.friends.markAccepted(requestId);
    const conversationId = this.conversations.createForPair(meId, request.requester_id);

    // 요청자에게 수락 사실 + 새 대화방 ID를 실시간으로 알린다.
    const me = this.users.findPublicById(meId)!;
    this.deps.hub.sendToUser(request.requester_id, { t: 'f', k: 'acc', u: me, c: conversationId });

    return { conversationId };
  }

  /** 친구 목록 — 각 친구의 대화방 ID를 함께 반환해 바로 채팅을 열 수 있게 한다. */
  listFriends(meId: number): { user: PublicUser; c: number }[] {
    return this.friends.listFriends(meId).map((user) => ({
      user,
      c: this.conversations.createForPair(meId, user.id),
    }));
  }
}
