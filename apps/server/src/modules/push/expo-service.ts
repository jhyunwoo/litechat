/**
 * Expo Push 서비스 — 오프라인 사용자의 네이티브 앱(iOS)으로 푸시 알림을 보낸다.
 *
 * Expo Push API(https://exp.host/--/api/v2/push/send)에 직접 fetch한다.
 * 트래픽이 소량(1:1 채팅)이라 expo-server-sdk 없이 충분하다.
 *
 * 발송 함수(sender)를 주입할 수 있어 테스트에서는 실제 API 호출 없이 검증한다.
 */
import type { AppDeps } from '../../deps';
import type { OfflineMessageHook } from '../chat/service';
import { ExpoPushRepo } from './expo-repo';
import { previewOf } from './preview';

/** Expo Push API 요청 메시지 */
export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  /** 알림 탭 시 딥링크에 쓰는 데이터 — c: 대화방 ID */
  data: { c: number };
  sound: 'default';
  /** iOS 앱 아이콘 배지 수 (전체 안읽음) */
  badge: number;
}

/** Expo Push API 티켓 — 발송 요청당 하나 */
export interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/** 발송 함수 시그니처 — 입력 순서대로 티켓을 반환한다 */
export type ExpoPushSender = (messages: ExpoPushMessage[]) => Promise<ExpoPushTicket[]>;

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

/** 영수증 확인까지 기다리는 시간 — Expo가 APNs 결과를 모으는 데 걸리는 여유 */
const RECEIPT_DELAY_MS = 15 * 60 * 1000;

/** exp.host 기반 기본 발송 함수 */
function createExpoSender(accessToken: string): ExpoPushSender {
  return async (messages) => {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(messages),
    });
    if (!res.ok) throw new Error(`expo push send failed: ${res.status}`);
    const { data } = (await res.json()) as { data: ExpoPushTicket[] };
    return data;
  };
}

export class ExpoPushService {
  private repo: ExpoPushRepo;
  private sender: ExpoPushSender;
  /** 영수증 확인 대기 중인 티켓: id → { token, at } */
  private pendingReceipts = new Map<string, { token: string; at: number }>();

  constructor(
    private deps: AppDeps,
    sender?: ExpoPushSender,
  ) {
    this.repo = new ExpoPushRepo(deps.db);
    this.sender = sender ?? createExpoSender(deps.config.expoPushAccessToken);
  }

  /** 토큰 등록 (알림 켜기) */
  register(userId: number, token: string): void {
    this.repo.upsert(userId, token);
  }

  /** 본인 토큰 해지 (알림 끄기) */
  unregister(userId: number, token: string): void {
    this.repo.deleteForUser(userId, token);
  }

  /**
   * ChatService에 주입되는 오프라인 훅.
   * fire-and-forget — 발송 실패가 메시지 저장/응답에 영향을 주면 안 된다.
   */
  offlineHook: OfflineMessageHook = (peerId, sender, message) => {
    void this.sendToUser(peerId, sender.nickname, previewOf(message), message.c);
  };

  /** 사용자의 모든 기기로 발송. 만료 토큰(DeviceNotRegistered)은 삭제한다. */
  private async sendToUser(
    userId: number,
    title: string,
    body: string,
    conversationId: number,
  ): Promise<void> {
    const rows = this.repo.listByUser(userId);
    if (rows.length === 0) {
      console.log(`[expo-push] user=${userId} offline but has 0 tokens — nothing to send`);
      return;
    }

    const badge = this.repo.countUnread(userId);
    const messages: ExpoPushMessage[] = rows.map((row) => ({
      to: row.token,
      title,
      body,
      data: { c: conversationId },
      sound: 'default',
      badge,
    }));

    console.log(`[expo-push] user=${userId} sending to ${rows.length} token(s)`);
    try {
      const tickets = await this.sender(messages);
      let ok = 0;
      tickets.forEach((ticket, index) => {
        const token = rows[index]?.token;
        if (!token) return;
        if (ticket.status === 'error') {
          if (ticket.details?.error === 'DeviceNotRegistered') {
            // 앱 삭제 등으로 무효해진 토큰 — 더 이상 보낼 수 없으니 정리한다.
            this.repo.deleteByToken(token);
            console.log(`[expo-push] user=${userId} pruned unregistered token`);
          } else {
            console.error(`[expo-push] user=${userId} ticket error: ${ticket.details?.error}`);
          }
        } else {
          ok += 1;
          // APNs 단계의 실패(DeviceNotRegistered)는 영수증으로만 알 수 있다.
          if (ticket.id) this.pendingReceipts.set(ticket.id, { token, at: Date.now() });
        }
      });
      console.log(`[expo-push] user=${userId} done: ok=${ok}/${tickets.length}`);
    } catch (error) {
      console.error(`[expo-push] user=${userId} send failed:`, error);
    }

    // 이전 발송분의 영수증을 게으르게 확인한다 (별도 스케줄러 없이).
    await this.checkPendingReceipts();
  }

  /** 15분 이상 지난 티켓의 영수증을 확인하고 무효 토큰을 정리한다. */
  private async checkPendingReceipts(): Promise<void> {
    const now = Date.now();
    const due = [...this.pendingReceipts.entries()].filter(([, v]) => now - v.at > RECEIPT_DELAY_MS);
    if (due.length === 0) return;

    try {
      const res = await fetch(EXPO_RECEIPTS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.deps.config.expoPushAccessToken
            ? { Authorization: `Bearer ${this.deps.config.expoPushAccessToken}` }
            : {}),
        },
        body: JSON.stringify({ ids: due.map(([id]) => id) }),
      });
      if (!res.ok) return;
      const { data } = (await res.json()) as {
        data: Record<string, { status: 'ok' | 'error'; details?: { error?: string } }>;
      };
      for (const [id, { token }] of due) {
        const receipt = data[id];
        if (receipt?.details?.error === 'DeviceNotRegistered') {
          this.repo.deleteByToken(token);
          console.log('[expo-push] pruned token via receipt');
        }
        this.pendingReceipts.delete(id);
      }
    } catch (error) {
      // 영수증 확인 실패는 다음 발송 때 재시도된다.
      console.error('[expo-push] receipt check failed:', error);
    }
  }
}
