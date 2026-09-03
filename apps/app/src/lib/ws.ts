/**
 * WebSocket 클라이언트 — apps/web/src/ws.ts의 네이티브 포팅
 *
 * - 지수 백오프 재연결 (0.5s → 8s 상한, 지터 포함)
 * - 25초 간격 앱 레벨 핑으로 유휴 연결 유지
 * - 재연결 성공 시 'reconnect' 이벤트 → 화면들이 REST로 밀린 데이터를 따라잡는다
 *
 * 웹과의 차이:
 *   - 인증: RN WebSocket의 headers 옵션으로 Bearer 토큰을 보낸다 (쿠키 없음)
 *   - 생명주기: pagehide/pageshow 대신 AppState background/active.
 *     백그라운드에서 소켓을 깨끗하게 닫아야 서버가 즉시 오프라인으로 인식해
 *     이후 도착하는 메시지가 푸시 알림으로 발송된다.
 */
import type { ClientFrame, ServerFrame } from '@litechat/types';
import { AppState, type AppStateStatus } from 'react-native';
import { wsUrl } from './env';
import { getToken } from './session';

type Listener = (frame: ServerFrame) => void;

/**
 * 재연결 대기 시간 — 지수 백오프에 지터를 섞는다.
 *
 * 지터가 없으면 재배포처럼 모든 클라이언트가 동시에 끊긴 상황에서 전부 같은 시각에
 * 재연결을 시도해(썬더링 허드) 막 뜬 컨테이너를 때린다. 실제 대기는 계산된 백오프의
 * 50~100% 구간에서 무작위로 고른다 — 복구 속도는 유지하면서 시도 시각만 흩뜨린다.
 */
function jittered(delay: number): number {
  return delay / 2 + Math.random() * (delay / 2);
}


/** RN WebSocket 생성자 — 세 번째 인자로 헤더를 받는다 (테스트에서 주입 가능) */
export type WebSocketFactory = (url: string, headers: Record<string, string>) => WebSocket;

const defaultFactory: WebSocketFactory = (url, headers) =>
  // RN의 WebSocket은 (url, protocols, { headers }) 시그니처를 지원한다.
  new (WebSocket as unknown as new (
    url: string,
    protocols: string | null,
    options: { headers: Record<string, string> },
  ) => WebSocket)(url, null, { headers });

export class ChatSocket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private reconnectListeners = new Set<() => void>();
  private retryDelay = 500;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldRun = false;
  /** 앱이 백그라운드로 가서 잠시 끊긴 상태. resume 시 다시 연결한다. */
  private paused = false;
  /** 최초 연결이 아닌 재연결인지 구분 (catch-up 트리거용) */
  private hasConnectedOnce = false;

  constructor(private factory: WebSocketFactory = defaultFactory) {}

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
    this.clearTimers();
    this.ws?.close();
    this.ws = null;
    this.hasConnectedOnce = false;
  }

  /** 앱이 백그라운드로 갈 때 호출 — 소켓을 깨끗하게 닫는다 */
  pause(): void {
    if (!this.shouldRun || this.paused) return;
    this.paused = true;
    this.clearTimers();
    this.ws?.close();
    this.ws = null;
  }

  /** 앱이 다시 활성화될 때 호출 — 연결을 재개한다 */
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
    const token = getToken();
    if (!token) return; // 토큰 없이는 업그레이드가 401로 거부된다
    const ws = this.factory(wsUrl(), { Authorization: `Bearer ${token}` });
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
      // 지수 백오프 + 지터 재연결
      this.retryTimer = setTimeout(() => this.connect(), jittered(this.retryDelay));
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

  private clearTimers(): void {
    this.clearPing();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}

/** 앱 전역 싱글턴 소켓 */
export const socket = new ChatSocket();

/**
 * AppState → 소켓 생명주기 연결.
 * background: 즉시 닫아 서버가 오프라인으로 인식 → 푸시 발송 경로가 열린다.
 * active: 재연결 + reconnect 이벤트로 밀린 데이터 catch-up.
 */
export function bindAppState(target: ChatSocket = socket): () => void {
  const onChange = (state: AppStateStatus) => {
    if (state === 'background') target.pause();
    else if (state === 'active') target.resume();
  };
  const subscription = AppState.addEventListener('change', onChange);
  return () => subscription.remove();
}
