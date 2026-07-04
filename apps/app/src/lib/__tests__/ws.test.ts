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

  test('끊기면 지수 백오프로 재연결한다 (0.5s → 8s 상한)', () => {
    const socket = new ChatSocket(factory);
    socket.start();
    expect(FakeWebSocket.instances).toHaveLength(1);

    // 1차 종료 → 500ms 후 재연결
    lastSocket().close();
    jest.advanceTimersByTime(499);
    expect(FakeWebSocket.instances).toHaveLength(1);
    jest.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    // 2차 종료 → 1000ms
    lastSocket().close();
    jest.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(3);

    // 여러 번 실패해도 8초를 넘지 않는다.
    for (let i = 0; i < 10; i += 1) {
      lastSocket().close();
      jest.advanceTimersByTime(8000);
    }
    const before = FakeWebSocket.instances.length;
    lastSocket().close();
    jest.advanceTimersByTime(8000);
    expect(FakeWebSocket.instances.length).toBe(before + 1);
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
