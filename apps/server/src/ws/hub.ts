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
 * 소켓 하나가 쌓아 둘 수 있는 미전송 바이트 상한 (1 MiB).
 *
 * 모바일 네트워크가 끊기기 직전처럼 아주 느린 클라이언트가 있으면 커널 송신 버퍼가
 * 비워지지 않아 프레임이 무한정 쌓인다. 상한을 두지 않으면 그런 소켓 몇 개가 서버
 * 메모리를 잠식한다(2 OCPU/12 GB 단일 인스턴스라 더 치명적이다).
 *
 * 상한을 넘으면 소켓을 닫는다 — 데이터 유실은 아니다. 클라이언트는 재연결 후
 * `GET /api/chat/:id/messages?after=` 로 밀린 메시지를 그대로 따라잡는다(설계된 복구 경로).
 */
const MAX_BUFFERED_BYTES = 1024 * 1024;

/** Bun ServerWebSocket의 송신 버퍼 크기 — hono WSContext 뒤의 원시 소켓에서 읽는다. */
function bufferedAmountOf(ws: WSContext): number {
  const raw = ws.raw as { getBufferedAmount?: () => number } | undefined;
  return raw?.getBufferedAmount?.() ?? 0;
}

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
    return this.sendPayload(userId, JSON.stringify(frame), exclude);
  }

  /**
   * 이미 직렬화된 프레임을 전송한다.
   *
   * 같은 프레임을 여러 사용자에게 팬아웃할 때 JSON.stringify를 한 번만 하기 위해
   * 분리했다 (메시지 하나당 상대 + 내 다른 기기 = 최소 2회 → 1회).
   */
  sendPayload(userId: number, payload: string, exclude?: WSContext): boolean {
    const sockets = this.connections.get(userId);
    if (!sockets || sockets.size === 0) return false;
    const excludeKey = exclude ? keyOf(exclude) : null;
    let delivered = false;
    for (const [key, ws] of sockets) {
      if (key === excludeKey) continue;
      // 백프레셔: 못 따라오는 소켓은 끊는다. 재연결 후 catch-up으로 복구된다.
      if (bufferedAmountOf(ws) > MAX_BUFFERED_BYTES) {
        ws.close(1013, 'Too slow');
        sockets.delete(key);
        continue;
      }
      ws.send(payload);
      delivered = true;
    }
    if (sockets.size === 0) this.connections.delete(userId);
    return delivered;
  }

  /** 현재 온라인(소켓 연결 존재) 여부 */
  isOnline(userId: number): boolean {
    return (this.connections.get(userId)?.size ?? 0) > 0;
  }

  /** 계정 삭제/강제 로그아웃 시 해당 사용자의 모든 실시간 연결을 닫는다. */
  disconnectUser(userId: number): void {
    const sockets = this.connections.get(userId);
    if (!sockets) return;
    for (const ws of sockets.values()) ws.close(1000, 'Session ended');
    this.connections.delete(userId);
  }

  /** 현재 열린 소켓 수 — 종료 로그/관측성용 */
  get socketCount(): number {
    let total = 0;
    for (const sockets of this.connections.values()) total += sockets.size;
    return total;
  }

  /**
   * 종료 시 모든 연결을 명시적으로 닫는다.
   *
   * 명시적으로 닫아야 클라이언트가 소켓 타임아웃을 기다리지 않고 곧바로 재연결
   * 루프에 들어간다 — 재배포 후 실시간 복구가 빨라진다 (실측: SIGTERM 후 2 ms 안에
   * 10개 소켓 전부 onclose). 1001(Going Away)은 의미상 맞는 코드지만, 클라이언트가
   * 실제로 보는 코드와 무관하게 재연결 동작은 동일하다.
   * (클라이언트의 백오프에는 지터가 있어 새 컨테이너로 동시에 몰리지 않는다.)
   */
  closeAll(): void {
    for (const sockets of this.connections.values()) {
      for (const ws of sockets.values()) ws.close(1001, 'Server restarting');
    }
    this.connections.clear();
  }
}
