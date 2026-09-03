/**
 * WebSocket 클라이언트 테스트 — 가짜 소켓 + 가짜 타이머로 수명주기 검증
 */
import type { ServerFrame } from '@litechat/types';
import { ChatSocket, type WebSocketFactory } from '../ws';

jest.mock('@/lib/session', () => ({
  getToken: () => 'test-token',
}));

/** 최소 가짜 WebSocket — 핸들러를 밖에서 발화시킬 수 있다 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  url: string;
  headers: Record<string, string>;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string, headers: Record<string, string>) {
    this.url = url;
    this.headers = headers;
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = WebSocket.OPEN;
    this.onopen?.();
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

const factory: WebSocketFactory = (url, headers) =>
  new FakeWebSocket(url, headers) as unknown as WebSocket;

function lastSocket(): FakeWebSocket {
  return FakeWebSocket.instances.at(-1)!;
}

beforeEach(() => {
  jest.useFakeTimers();
  FakeWebSocket.instances = [];
});

afterEach(() => {
  jest.useRealTimers();
});

describe('ChatSocket', () => {
  test('start()는 Bearer 헤더를 포함해 연결한다', () => {
    const socket = new ChatSocket(factory);
    socket.start();
    expect(lastSocket().headers).toEqual({ Authorization: 'Bearer test-token' });
    socket.stop();
  });

  test('연결 전 send는 false를 반환한다 (REST 폴백 신호)', () => {
    const socket = new ChatSocket(factory);
    socket.start();
    expect(socket.send({ t: 'p' })).toBe(false);
    lastSocket().open();
    expect(socket.send({ t: 'p' })).toBe(true);
    socket.stop();
  });

  test('끊기면 지수 백오프 + 지터로 재연결한다 (상한 8s)', () => {
    // 재배포처럼 모든 클라이언트가 동시에 끊긴 상황에서 같은 시각에 몰려 재연결하지
    // 않도록, 실제 대기는 계산된 백오프의 50~100% 구간에서 무작위로 고른다.
    // 따라서 정확한 시각이 아니라 "구간 안에 들어오는가"를 검증한다.
    const socket = new ChatSocket(factory);
    socket.start();
    expect(FakeWebSocket.instances).toHaveLength(1);

    /** 소켓을 끊고, 재연결이 실제로 일어난 시각(ms)을 1ms 단위로 되돌려 준다 */
    const reconnectDelay = (cap: number): number => {
      const before = FakeWebSocket.instances.length;
      lastSocket().close();
      for (let elapsed = 1; elapsed <= cap; elapsed += 1) {
        jest.advanceTimersByTime(1);
        if (FakeWebSocket.instances.length > before) return elapsed;
      }
      return Number.POSITIVE_INFINITY;
    };

    // 1차: 백오프 500ms → 실제 대기는 [250, 500)
    const first = reconnectDelay(1000);
    expect(first).toBeGreaterThanOrEqual(250);
    expect(first).toBeLessThan(500);

    // 2차: 백오프 1000ms → [500, 1000)
    const second = reconnectDelay(2000);
    expect(second).toBeGreaterThanOrEqual(500);
    expect(second).toBeLessThan(1000);

    // 여러 번 실패해도 상한(8초)을 넘지 않는다 — 지터를 감안해도 8000ms 안에 반드시 재연결한다.
    for (let i = 0; i < 10; i += 1) {
      expect(reconnectDelay(8000)).toBeLessThanOrEqual(8000);
    }
    socket.stop();
  });

  test('25초마다 앱 레벨 핑을 보낸다', () => {
    const socket = new ChatSocket(factory);
    socket.start();
    lastSocket().open();
    jest.advanceTimersByTime(25000);
    expect(lastSocket().sent).toContain('{"t":"p"}');
    socket.stop();
  });

  test('pause()는 소켓을 닫고 재연결하지 않는다 (백그라운드 → 푸시 경로)', () => {
    const socket = new ChatSocket(factory);
    socket.start();
    lastSocket().open();

    socket.pause();
    expect(FakeWebSocket.instances).toHaveLength(1);
    jest.advanceTimersByTime(60000);
    expect(FakeWebSocket.instances).toHaveLength(1); // 재연결 없음

    socket.resume();
    expect(FakeWebSocket.instances).toHaveLength(2);
    socket.stop();
  });

  test('재연결 성공 시에만 reconnect 이벤트가 발화한다', () => {
    const socket = new ChatSocket(factory);
    const onReconnect = jest.fn();
    socket.onReconnect(onReconnect);
    socket.start();

    lastSocket().open(); // 최초 연결 — reconnect 아님
    expect(onReconnect).not.toHaveBeenCalled();

    lastSocket().close();
    jest.advanceTimersByTime(500);
    lastSocket().open(); // 재연결
    expect(onReconnect).toHaveBeenCalledTimes(1);
    socket.stop();
  });

  test('프레임을 리스너에 분배하고 퐁(q)은 소비한다', () => {
    const socket = new ChatSocket(factory);
    const frames: ServerFrame[] = [];
    socket.onFrame((frame) => frames.push(frame));
    socket.start();
    lastSocket().open();

    lastSocket().onmessage?.({ data: '{"t":"q"}' });
    lastSocket().onmessage?.({ data: '{"t":"r","c":1,"u":2,"m":3}' });
    lastSocket().onmessage?.({ data: 'not-json' });

    expect(frames).toEqual([{ t: 'r', c: 1, u: 2, m: 3 }]);
    socket.stop();
  });
});
