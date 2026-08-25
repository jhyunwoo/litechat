/**
 * 데이터 계층 테스트 — handleFrame 리듀서 + 낙관적 전송/폴백
 *
 * 실제 QueryClient 캐시에 대고 검증한다 (WS/REST는 모킹).
 */
import type { ConversationSummary, WireMessage } from '@litechat/types';
import { QueryClient } from '@tanstack/react-query';
import { socket } from '@/lib/ws';
import { handleFrame, markRead, sendMessage } from '../data';

// WS 소켓 모킹 — 각 테스트에서 send 반환값을 조절한다.
jest.mock('@/lib/ws', () => ({
  socket: { send: jest.fn(), onFrame: jest.fn(), onReconnect: jest.fn() },
}));

// REST 클라이언트 모킹 — 폴백 경로 검증용
const mockPostMessage = jest.fn();
const mockPostRead = jest.fn();
jest.mock('@/lib/api', () => ({
  api: {
    api: {
      chat: {
        ':id': {
          messages: { $post: (...args: unknown[]) => mockPostMessage(...args) },
          read: { $post: (...args: unknown[]) => mockPostRead(...args) },
        },
      },
    },
  },
  unwrap: async (res: { ok: boolean; json(): Promise<unknown> }) => {
    if (!res.ok) throw new Error('fail');
    return res.json();
  },
}));

const ME = 1;
const PEER = 2;
const CONV = 10;

function makeClient(): QueryClient {
  const queryClient = new QueryClient();
  const conversation: ConversationSummary = {
    id: CONV,
    peer: { id: PEER, username: 'peer', nickname: '상대' },
    last: null,
    unread: 0,
    peerRead: 0,
  };
  queryClient.setQueryData(['conversations'], [conversation]);
  queryClient.setQueryData(['messages', CONV], []);
  return queryClient;
}

function messagesIn(queryClient: QueryClient): WireMessage[] {
  return queryClient.getQueryData<WireMessage[]>(['messages', CONV])!;
}

function conversationIn(queryClient: QueryClient): ConversationSummary {
  return queryClient.getQueryData<ConversationSummary[]>(['conversations'])![0]!;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('handleFrame', () => {
  test('m: 상대 메시지는 캐시에 추가되고 unread가 증가한다', () => {
    const queryClient = makeClient();
    handleFrame(queryClient, ME, { t: 'm', id: 5, c: CONV, s: PEER, k: 't', x: '안녕', ts: 100 });

    expect(messagesIn(queryClient)).toHaveLength(1);
    expect(messagesIn(queryClient)[0]).toMatchObject({ id: 5, x: '안녕' });
    expect(conversationIn(queryClient).unread).toBe(1);
    expect(conversationIn(queryClient).last).toMatchObject({ id: 5 });
  });

  test('m: 내 다른 기기의 메시지는 unread를 올리지 않는다', () => {
    const queryClient = makeClient();
    handleFrame(queryClient, ME, { t: 'm', id: 6, c: CONV, s: ME, k: 't', x: '내꺼', ts: 100 });
    expect(conversationIn(queryClient).unread).toBe(0);
  });

  test('r: 상대 읽음 워터마크가 전진한다', () => {
    const queryClient = makeClient();
    handleFrame(queryClient, ME, { t: 'r', c: CONV, u: PEER, m: 42 });
    expect(conversationIn(queryClient).peerRead).toBe(42);
  });

  test('a: 낙관적 메시지가 실제 ID/시각으로 교체된다', async () => {
    const queryClient = makeClient();
    jest.mocked(socket.send).mockReturnValue(true); // WS 경로

    await sendMessage(queryClient, ME, CONV, 't', '전송 테스트');
    expect(messagesIn(queryClient)[0]!.id).toBeLessThan(0); // 임시 음수 ID

    // 서버 ack — socket.send로 보낸 임시 키를 그대로 돌려받는다.
    const frame = jest.mocked(socket.send).mock.calls[0]![0] as { i: string };
    handleFrame(queryClient, ME, { t: 'a', i: frame.i, id: 99, ts: 200 });

    expect(messagesIn(queryClient)).toHaveLength(1);
    expect(messagesIn(queryClient)[0]).toMatchObject({ id: 99, ts: 200, x: '전송 테스트' });
  });

  test('e: 전송 실패한 임시 메시지가 제거된다', async () => {
    const queryClient = makeClient();
    jest.mocked(socket.send).mockReturnValue(true);

    await sendMessage(queryClient, ME, CONV, 't', '실패할 메시지');
    const frame = jest.mocked(socket.send).mock.calls[0]![0] as { i: string };
    handleFrame(queryClient, ME, { t: 'e', m: 'INVALID_CONTENT', i: frame.i });

    expect(messagesIn(queryClient)).toHaveLength(0);
  });
});

describe('sendMessage REST 폴백', () => {
  test('소켓이 닫혀 있으면 REST로 보내고 응답으로 확정한다', async () => {
    const queryClient = makeClient();
    jest.mocked(socket.send).mockReturnValue(false); // WS 불가
    mockPostMessage.mockResolvedValue({
      ok: true,
      json: async () => ({ message: { id: 77, c: CONV, s: ME, k: 't', x: '폴백', ts: 300 } }),
    });

    await sendMessage(queryClient, ME, CONV, 't', '폴백');

    expect(mockPostMessage).toHaveBeenCalledWith({
      param: { id: String(CONV) },
      json: { k: 't', x: '폴백' },
    });
    expect(messagesIn(queryClient)[0]).toMatchObject({ id: 77, ts: 300 });
  });

  test('REST도 실패하면 낙관적 메시지를 제거하고 던진다', async () => {
    const queryClient = makeClient();
    jest.mocked(socket.send).mockReturnValue(false);
    mockPostMessage.mockResolvedValue({ ok: false, json: async () => ({ error: 'INTERNAL' }) });

    await expect(sendMessage(queryClient, ME, CONV, 't', '실패')).rejects.toThrow();
    expect(messagesIn(queryClient)).toHaveLength(0);
  });
});

describe('markRead', () => {
  test('unread를 0으로 만들고 WS로 워터마크를 보낸다', () => {
    const queryClient = makeClient();
    handleFrame(queryClient, ME, { t: 'm', id: 5, c: CONV, s: PEER, k: 't', x: 'x', ts: 1 });
    jest.mocked(socket.send).mockReturnValue(true);

    markRead(queryClient, CONV, 5);
    expect(conversationIn(queryClient).unread).toBe(0);
    expect(socket.send).toHaveBeenCalledWith({ t: 'r', c: CONV, m: 5 });
    expect(mockPostRead).not.toHaveBeenCalled();
  });

  test('WS가 닫혀 있으면 REST로 폴백한다', () => {
    const queryClient = makeClient();
    jest.mocked(socket.send).mockReturnValue(false);
    mockPostRead.mockResolvedValue({ ok: true, json: async () => ({ watermark: 5 }) });

    markRead(queryClient, CONV, 5);
    expect(mockPostRead).toHaveBeenCalledWith({ param: { id: String(CONV) }, json: { m: 5 } });
  });

  test('임시(음수) ID는 무시한다', () => {
    const queryClient = makeClient();
    markRead(queryClient, CONV, -3);
    expect(socket.send).not.toHaveBeenCalled();
    expect(mockPostRead).not.toHaveBeenCalled();
  });
});
