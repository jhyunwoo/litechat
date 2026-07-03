/**
 * WebSocket 허브 — 접속 중인 사용자와 소켓의 레지스트리
 *
 * 단일 프로세스 배포이므로 인메모리 Map으로 팬아웃한다.
 * (다중 인스턴스로 확장할 경우 이 클래스만 Redis pub/sub 구현으로 교체하면 된다.)
 *
 * 한 사용자가 여러 기기/탭으로 접속할 수 있으므로 userId → Set<소켓> 구조를 쓴다.
 */
import type { ServerFrame } from '@litechat/types';
import { createBunWebSocket } from 'hono/bun';
import type { WSContext } from 'hono/ws';

/** Bun 전용 WebSocket 헬퍼 — upgradeWebSocket은 라우트에서, websocket은 Bun.serve에서 사용 */
export const { upgradeWebSocket, websocket } = createBunWebSocket();

/**
 * 소켓 동일성 키 — hono의 Bun 어댑터는 이벤트마다 새 WSContext 래퍼를 만들므로
 * 래퍼 객체가 아니라 내부의 원시 Bun 소켓(raw)으로 비교해야 한다.
 */
function keyOf(ws: WSContext): object {
  return (ws.raw as object | undefined) ?? ws;
}

export class WsHub {
  /** userId → (원시 소켓 → WSContext) — 원시 소켓을 키로 써서 래퍼 재생성에 안전 */
  private connections = new Map<number, Map<object, WSContext>>();

  /** 소켓 등록 (WS onOpen 시) */
  add(userId: number, ws: WSContext): void {
    let sockets = this.connections.get(userId);
    if (!sockets) {
      sockets = new Map();
      this.connections.set(userId, sockets);
    }
    sockets.set(keyOf(ws), ws);
  }

  /** 소켓 해제 (WS onClose 시) */
  remove(userId: number, ws: WSContext): void {
    const sockets = this.connections.get(userId);
    if (!sockets) return;
    sockets.delete(keyOf(ws));
    if (sockets.size === 0) this.connections.delete(userId);
  }

  /**
   * 특정 사용자의 모든 기기로 프레임을 전송한다.
   * @param exclude 제외할 소켓 — 메시지를 보낸 본인 소켓은 ack만 받으면 되므로 제외한다.
   * @returns 연결된 소켓이 하나라도 있으면 true (오프라인이면 false → 푸시 알림 대상)
   */
  sendToUser(userId: number, frame: ServerFrame, exclude?: WSContext): boolean {
    const sockets = this.connections.get(userId);
    if (!sockets || sockets.size === 0) return false;
    const excludeKey = exclude ? keyOf(exclude) : null;
    const payload = JSON.stringify(frame);
    for (const [key, ws] of sockets) {
      if (key !== excludeKey) ws.send(payload);
    }
    return true;
  }

  /** 현재 온라인(소켓 연결 존재) 여부 */
  isOnline(userId: number): boolean {
    return (this.connections.get(userId)?.size ?? 0) > 0;
  }
}
