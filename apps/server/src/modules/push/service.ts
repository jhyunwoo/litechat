/**
 * Web Push 서비스 — 오프라인 사용자에게 브라우저 푸시 알림을 보낸다.
 *
 * VAPID 키가 설정되어 있지 않으면 전체 기능이 조용히 비활성화된다
 * (로컬 개발 환경에서 키 없이도 서버가 뜨도록).
 *
 * 발송 함수(sender)를 주입할 수 있어 테스트에서는 실제 푸시 서비스 없이 검증한다.
 */
import type { PushSubscribeInput } from '@litechat/types';
import webpush from 'web-push';
import { isPushEndpoint } from './endpoint';
import { errors } from '../../errors';
import type { AppDeps } from '../../deps';
import type { OfflineMessageHook } from '../chat/service';
import { previewOf } from './preview';
import { PushRepo, type PushSubscriptionRow } from './repo';
import { NotificationLogRepo } from './notification-log-repo';

/** 발송 함수 시그니처 — 프로덕션에서는 web-push, 테스트에서는 기록용 가짜 */
export type PushSender = (subscription: PushSubscriptionRow, payload: string) => Promise<void>;

/** 알림 페이로드 — 서비스 워커가 그대로 Notification으로 표시한다 */
interface PushPayload {
  /** 보낸 사람 닉네임 */
  title: string;
  /** 메시지 미리보기 */
  body: string;
  /** 알림 클릭 시 열 대화방 ID */
  c: number;
  /** notification_log.id — 클라이언트 ACK가 그대로 돌려보낸다 */
  n: number;
}

/** web-push 기반 기본 발송 함수 */
function createWebPushSender(deps: AppDeps): PushSender {
  webpush.setVapidDetails(
    deps.config.vapidSubject,
    deps.config.vapidPublicKey,
    deps.config.vapidPrivateKey,
  );
  return async (subscription, payload) => {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      payload,
      // TTL: 하루 — 그 안에 기기가 온라인되지 않으면 폐기
      { TTL: 86400, timeout: 10_000 },
    );
  };
}

export class PushService {
  private repo: PushRepo;
  private sender: PushSender | null;

  constructor(
    private deps: AppDeps,
    private log: NotificationLogRepo,
    sender?: PushSender,
  ) {
    this.repo = new PushRepo(deps.db);
    const hasKeys = Boolean(deps.config.vapidPublicKey && deps.config.vapidPrivateKey);
    this.sender = sender ?? (hasKeys ? createWebPushSender(deps) : null);
  }

  get enabled(): boolean {
    return this.sender !== null;
  }

  get publicKey(): string {
    return this.deps.config.vapidPublicKey;
  }

  subscribe(userId: number, input: PushSubscribeInput): void {
    if (!isPushEndpoint(input.endpoint)) throw errors.badRequest('INVALID_PUSH_ENDPOINT');
    const subscriptions = this.repo.listByUser(userId);
    if (subscriptions.length >= 10 && !subscriptions.some((s) => s.endpoint === input.endpoint))
      throw errors.badRequest('PUSH_SUBSCRIPTION_LIMIT');
    this.repo.upsert(userId, input.endpoint, input.keys.p256dh, input.keys.auth);
  }

  unsubscribe(userId: number, endpoint: string): void {
    this.repo.deleteForUser(userId, endpoint);
  }

  offlineHook: OfflineMessageHook = (peerId, sender, message) => {
    if (!this.sender) return;
    void this.sendToUser(peerId, sender.nickname, previewOf(message), message.c);
  };

  /** 사용자의 모든 기기로 발송. 만료(404/410) 구독은 삭제한다. */
  private async sendToUser(
    userId: number,
    title: string,
    body: string,
    conversationId: number,
  ): Promise<void> {
    if (!this.sender) return;
    const subscriptions = this.repo.listByUser(userId);
    if (subscriptions.length === 0) {
      console.log(`[push] user=${userId} offline but has 0 subscriptions — nothing to send`);
      return;
    }
    console.log(`[push] user=${userId} sending to ${subscriptions.length} subscription(s)`);
    let ok = 0;
    let failed = 0;
    for (const subscription of subscriptions) {
      // Recheck rows saved before endpoint validation was introduced.
      if (!isPushEndpoint(subscription.endpoint)) continue;
      const logId = this.log.insert({
        userId,
        channel: 'web',
        conversationId,
        bodyPreview: body,
      });
      const payload: PushPayload = { title, body, c: conversationId, n: logId };
      try {
        await this.sender(subscription, JSON.stringify(payload));
        ok += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          this.repo.deleteByEndpoint(subscription.endpoint);
          this.log.markFailed(logId, 'expired', `subscription gone (${status})`);
          console.log(`[push] user=${userId} pruned expired subscription (${status})`);
        } else {
          failed += 1;
          this.log.markFailed(logId, 'error', String((error as Error)?.message ?? error));
          console.error(`[push] user=${userId} send failed (status=${status ?? 'n/a'}):`, error);
        }
      }
    }
    console.log(`[push] user=${userId} done: ok=${ok} failed=${failed}`);
  }
}
