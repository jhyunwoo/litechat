/**
 * WebSocket 엔드포인트: GET /ws
 *
 * 인증은 세션 쿠키로 처리한다 (브라우저는 WS 업그레이드 요청에도 쿠키를 보낸다).
 * 프레임 프로토콜은 @litechat/types의 protocol.ts 참고.
 */
import { parseClientFrame } from '@litechat/types';
import { Hono } from 'hono';
import type { AppEnv } from '../app';
import type { AppDeps } from '../deps';
import { ApiError } from '../errors';
import { requireAuth } from '../middleware/auth';
import type { ChatService } from '../modules/chat/service';
import { upgradeWebSocket } from './hub';

export function wsRoutes(deps: AppDeps, chat: ChatService) {
  return new Hono<AppEnv>().get(
    '/ws',
    requireAuth(deps),
    upgradeWebSocket((c) => {
      // 업그레이드 시점의 인증된 사용자 — 소켓 수명 동안 고정된다.
      const userId = c.var.userId;

      return {
        onOpen(_event, ws) {
          deps.hub.add(userId, ws);
        },

        onMessage(event, ws) {
          const frame = parseClientFrame(event.data);
          if (!frame) return; // 알 수 없는 프레임은 조용히 무시 (프로토콜 강건성)

          try {
            switch (frame.t) {
              case 'm': {
                // 메시지 전송 → 본인에게는 ack, 상대에게는 m 프레임
                const message = chat.sendMessage(userId, frame.c, frame.k, frame.x, ws, frame.r);
                ws.send(
                  JSON.stringify({
                    t: 'a',
                    i: frame.i,
                    id: message.id,
                    ts: message.ts,
                    ...(message.im ? { im: message.im } : {}),
                  }),
                );
                break;
              }
              case 'r':
                chat.markRead(userId, frame.c, frame.m);
                break;
              case 'p':
                ws.send(JSON.stringify({ t: 'q' }));
                break;
            }
          } catch (error) {
            // 서비스 오류는 e 프레임으로 통지한다 (전송 실패한 임시 ID 포함).
            const code = error instanceof ApiError ? error.code : 'INTERNAL';
            const i = frame.t === 'm' ? frame.i : undefined;
            ws.send(JSON.stringify({ t: 'e', m: code, ...(i ? { i } : {}) }));
          }
        },

        onClose(_event, ws) {
          deps.hub.remove(userId, ws);
        },
      };
    }),
  );
}
