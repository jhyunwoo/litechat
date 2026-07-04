/**
 * WebSocket 클라이언트 — 자동 재연결 + 프레임 이벤트 분배
 *
 * - 지수 백오프 재연결 (0.5s → 8s 상한)
 * - 25초 간격 앱 레벨 핑으로 유휴 연결 유지
 * - 재연결 성공 시 'reconnect' 이벤트 → 화면들이 REST로 밀린 데이터를 따라잡는다
 */
import type { ClientFrame, ServerFrame } from '@litechat/types';

type Listener = (frame: ServerFrame) => void;

class ChatSocket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private reconnectListeners = new Set<() => void>();
  private retryDelay = 500;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private shouldRun = false;
  /** 앱이 백그라운드/종료로 잠시 끊긴 상태 (pagehide). resume 시 다시 연결한다. */
  private paused = false;
  /** 최초 연결이 아닌 재연결인지 구분 (catch-up 트리거용) */
  private hasConnectedOnce = false;

  /** 로그인 후 호출 — 연결을 시작하고 유지한다 */
  start(): void {
    if (this.shouldRun) return;
    this.shouldRun = true;
    this.connect();
  }

  /** 로그아웃 시 호출 — 연결을 완전히 종료한다 */
  stop(): void {
    this.shouldRun = false;
    this.paused = false;
    this.clearPing();
    this.ws?.close();
    this.ws = null;
    this.hasConnectedOnce = false;
  }

  /**
   * 앱이 백그라운드로 가거나 닫힐 때(pagehide) 호출 — 소켓을 깨끗하게 닫는다.
   * 서버가 즉시 onClose로 사용자를 오프라인 처리해, 이후 도착하는 메시지가
   * 푸시 알림으로 발송된다(특히 iOS PWA는 백그라운드에서 JS가 중단되어
   * 실시간 수신이 불가하므로 이때 끊는 것이 옳다).
   */
  pause(): void {
    if (!this.shouldRun || this.paused) return;
    this.paused = true;
    this.clearPing();
    this.ws?.close();
    this.ws = null;
  }

  /** 앱이 다시 보일 때(pageshow) 호출 — 연결을 재개한다 */
  resume(): void {
    if (!this.shouldRun || !this.paused) return;
    this.paused = false;
    this.retryDelay = 500;
    this.connect();
  }

  /** 프레임 전송 — 연결이 없으면 false (호출자는 REST 폴백 사용) */
  send(frame: ClientFrame): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
      return true;
    }
    return false;
  }

  /** 서버 프레임 구독 */
  onFrame(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 재연결(끊겼다 다시 붙음) 구독 */
  onReconnect(listener: () => void): () => void {
    this.reconnectListeners.add(listener);
    return () => this.reconnectListeners.delete(listener);
  }

  private connect(): void {
    if (!this.shouldRun) return;
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${location.host}/ws`);
    this.ws = ws;

    ws.onopen = () => {
      this.retryDelay = 500;
      if (this.hasConnectedOnce) {
        // 끊긴 동안의 메시지를 화면들이 REST로 따라잡게 한다.
        for (const listener of this.reconnectListeners) listener();
      }
      this.hasConnectedOnce = true;
      this.startPing();
    };

    ws.onmessage = (event) => {
      try {
        const frame = JSON.parse(String(event.data)) as ServerFrame;
        if (frame.t === 'q') return; // 퐁은 소비만 한다
        for (const listener of this.listeners) listener(frame);
      } catch {
        /* 잘못된 프레임 무시 */
      }
    };

    ws.onclose = () => {
      this.clearPing();
      // 로그아웃(stop) 또는 백그라운드(pause)로 인한 종료면 재연결하지 않는다.
      if (!this.shouldRun || this.paused) return;
      // 지수 백오프 재연결
      setTimeout(() => this.connect(), this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 8000);
    };
  }

  private startPing(): void {
    this.clearPing();
    this.pingTimer = setInterval(() => this.send({ t: 'p' }), 25000);
  }

  private clearPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }
}

/** 앱 전역 싱글턴 소켓 */
export const socket = new ChatSocket();

// 앱이 백그라운드로 가거나 닫힐 때 소켓을 즉시 정리해 서버가 오프라인으로 인식하게 한다.
// (그래야 닫힌 iOS PWA로 푸시 알림이 발송된다) pagehide는 데스크톱 탭 전환에서는
// 발생하지 않고 실제 언로드/닫기에서만 발생하므로 데스크톱 연결은 유지된다.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => socket.pause());
  window.addEventListener('pageshow', () => socket.resume());
}
