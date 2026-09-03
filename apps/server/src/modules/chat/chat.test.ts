/**
 * 채팅 모듈 테스트 (TDD — 구현보다 먼저 작성됨)
 *
 * 대화 목록/메시지 조회/전송/읽음 워터마크와 실시간 팬아웃을 검증한다.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { createApp, type AppType } from '../../app';
import { createTestDeps, type AppDeps } from '../../deps';
import { fakeSocket, jsonRequest, signup } from '../../test/helpers';
import { MessagesRepo } from './messages-repo';

let deps: AppDeps;
let app: AppType;
let alice: Awaited<ReturnType<typeof signup>>;
let bob: Awaited<ReturnType<typeof signup>>;
let conversationId: number;

/** alice와 bob을 친구로 만들고 대화방 ID를 반환한다 */
async function becomeFriends(): Promise<number> {
  const req = await jsonRequest(app, '/api/friends/requests', {
    method: 'POST',
    cookie: alice.cookie,
    body: { userId: bob.user.id },
  });
  const { id } = (await req.json()) as { id: number };
  const res = await jsonRequest(app, `/api/friends/requests/${id}/respond`, {
    method: 'POST',
    cookie: bob.cookie,
    body: { accept: true },
  });
  return ((await res.json()) as { conversationId: number }).conversationId;
}

/** REST로 메시지를 보내고 WireMessage를 반환한다 */
async function sendMessage(from: { cookie: string }, text: string, conv = conversationId) {
  const res = await jsonRequest(app, `/api/chat/${conv}/messages`, {
    method: 'POST',
    cookie: from.cookie,
    body: { k: 't', x: text },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { message: { id: number } }).message;
}

beforeEach(async () => {
  deps = createTestDeps();
  app = createApp(deps);
  alice = await signup(app, 'alice', 'Alice');
  bob = await signup(app, 'bob', 'Bob');
  conversationId = await becomeFriends();
});

describe('POST /api/chat/:id/messages', () => {
  test('메시지를 저장하고 상대방에게 실시간 m 프레임을 보낸다', async () => {
    const bobSocket = fakeSocket(deps, bob.user.id);
    const message = await sendMessage(alice, '안녕 밥!');

    expect(message.id).toBeGreaterThan(0);
    expect(bobSocket.frames).toContainEqual(
      expect.objectContaining({ t: 'm', c: conversationId, s: alice.user.id, k: 't', x: '안녕 밥!' }),
    );
  });

  test('참여자가 아니면 403', async () => {
    const eve = await signup(app, 'eve', 'Eve');
    const res = await jsonRequest(app, `/api/chat/${conversationId}/messages`, {
      method: 'POST',
      cookie: eve.cookie,
      body: { k: 't', x: 'hack' },
    });
    expect(res.status).toBe(403);
  });

  test('빈 텍스트는 400', async () => {
    const res = await jsonRequest(app, `/api/chat/${conversationId}/messages`, {
      method: 'POST',
      cookie: alice.cookie,
      body: { k: 't', x: '' },
    });
    expect(res.status).toBe(400);
  });

  test('답장을 보내면 r이 저장되고 상대 프레임에도 실린다', async () => {
    const target = await sendMessage(alice, '원본 메시지');
    const bobSocket = fakeSocket(deps, bob.user.id);

    const res = await jsonRequest(app, `/api/chat/${conversationId}/messages`, {
      method: 'POST',
      cookie: bob.cookie,
      body: { k: 't', x: '답장이야', r: target.id },
    });
    expect(res.status).toBe(201);
    const { message } = (await res.json()) as { message: { r?: number } };
    expect(message.r).toBe(target.id);
    expect(bobSocket.frames).toContainEqual(
      expect.objectContaining({ t: 'm', x: '답장이야', r: target.id }),
    );
  });

  test('존재하지 않는 메시지를 인용하면 400', async () => {
    const res = await jsonRequest(app, `/api/chat/${conversationId}/messages`, {
      method: 'POST',
      cookie: alice.cookie,
      body: { k: 't', x: '유령 답장', r: 999_999 },
    });
    expect(res.status).toBe(400);
  });

  // 다른 대화의 메시지를 인용하면 그 본문이 refs를 타고 새어 나간다 — 반드시 막아야 한다.
  test('다른 대화의 메시지를 인용하면 400', async () => {
    const carol = await signup(app, 'carol2', 'Carol');
    const requested = await jsonRequest(app, '/api/friends/requests', {
      method: 'POST',
      cookie: alice.cookie,
      body: { userId: carol.user.id },
    });
    const { id: friendshipId } = (await requested.json()) as { id: number };
    const accepted = await jsonRequest(app, `/api/friends/requests/${friendshipId}/respond`, {
      method: 'POST',
      cookie: carol.cookie,
      body: { accept: true },
    });
    const otherConv = ((await accepted.json()) as { conversationId: number }).conversationId;
    const secret = await sendMessage(alice, '비밀', otherConv);

    const res = await jsonRequest(app, `/api/chat/${conversationId}/messages`, {
      method: 'POST',
      cookie: alice.cookie,
      body: { k: 't', x: '몰래 인용', r: secret.id },
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/chat/:id/messages', () => {
  test('오름차순으로 조회되고 after로 따라잡기가 가능하다', async () => {
    const m1 = await sendMessage(alice, '1');
    await sendMessage(bob, '2');
    await sendMessage(alice, '3');

    const all = (await (
      await jsonRequest(app, `/api/chat/${conversationId}/messages`, { cookie: alice.cookie })
    ).json()) as { messages: { x: string }[] };
    expect(all.messages.map((m) => m.x)).toEqual(['1', '2', '3']);

    // 재접속 catch-up: m1 이후의 메시지만
    const after = (await (
      await jsonRequest(app, `/api/chat/${conversationId}/messages?after=${m1.id}`, {
        cookie: alice.cookie,
      })
    ).json()) as { messages: { x: string }[] };
    expect(after.messages.map((m) => m.x)).toEqual(['2', '3']);
  });

  test('before로 과거 페이지네이션이 가능하다', async () => {
    for (let i = 1; i <= 5; i++) await sendMessage(alice, String(i));
    const latest = (await (
      await jsonRequest(app, `/api/chat/${conversationId}/messages?limit=2`, {
        cookie: alice.cookie,
      })
    ).json()) as { messages: { id: number; x: string }[] };
    // limit은 최신 메시지 기준으로 적용된다.
    expect(latest.messages.map((m) => m.x)).toEqual(['4', '5']);

    const older = (await (
      await jsonRequest(app, `/api/chat/${conversationId}/messages?before=${latest.messages[0]!.id}&limit=2`, {
        cookie: alice.cookie,
      })
    ).json()) as { messages: { x: string }[] };
    expect(older.messages.map((m) => m.x)).toEqual(['2', '3']);
  });

  test('참여자가 아니면 403', async () => {
    const eve = await signup(app, 'eve', 'Eve');
    const res = await jsonRequest(app, `/api/chat/${conversationId}/messages`, {
      cookie: eve.cookie,
    });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/chat (대화 목록)', () => {
  test('마지막 메시지/안읽음 수/상대 읽음 워터마크가 포함된다', async () => {
    await sendMessage(alice, 'first');
    const last = await sendMessage(alice, 'second');

    const forBob = (await (
      await jsonRequest(app, '/api/chat', { cookie: bob.cookie })
    ).json()) as {
      conversations: {
        id: number;
        peer: { username: string };
        last: { x: string } | null;
        unread: number;
        peerRead: number;
      }[];
    };
    expect(forBob.conversations).toHaveLength(1);
    const conv = forBob.conversations[0]!;
    expect(conv.peer.username).toBe('alice');
    expect(conv.last?.x).toBe('second');
    expect(conv.unread).toBe(2);

    // bob이 끝까지 읽으면 unread가 0이 되고, alice 쪽에는 peerRead가 갱신된다.
    await jsonRequest(app, `/api/chat/${conversationId}/read`, {
      method: 'POST',
      cookie: bob.cookie,
      body: { m: last.id },
    });
    const forBobAfter = (await (
      await jsonRequest(app, '/api/chat', { cookie: bob.cookie })
    ).json()) as { conversations: { unread: number }[] };
    expect(forBobAfter.conversations[0]?.unread).toBe(0);

    const forAlice = (await (
      await jsonRequest(app, '/api/chat', { cookie: alice.cookie })
    ).json()) as { conversations: { peerRead: number }[] };
    expect(forAlice.conversations[0]?.peerRead).toBe(last.id);
  });
});

describe('읽음 워터마크', () => {
  test('읽음 처리 시 상대방에게 r 프레임이 전송된다', async () => {
    const aliceSocket = fakeSocket(deps, alice.user.id);
    const message = await sendMessage(alice, 'hello');

    await jsonRequest(app, `/api/chat/${conversationId}/read`, {
      method: 'POST',
      cookie: bob.cookie,
      body: { m: message.id },
    });

    expect(aliceSocket.frames).toContainEqual({
      t: 'r',
      c: conversationId,
      u: bob.user.id,
      m: message.id,
    });
  });

  test('워터마크는 뒤로 이동하지 않는다', async () => {
    const m1 = await sendMessage(alice, '1');
    const m2 = await sendMessage(alice, '2');

    await jsonRequest(app, `/api/chat/${conversationId}/read`, {
      method: 'POST',
      cookie: bob.cookie,
      body: { m: m2.id },
    });
    // 과거 메시지로 다시 읽음 처리해도 워터마크는 m2에 머문다.
    await jsonRequest(app, `/api/chat/${conversationId}/read`, {
      method: 'POST',
      cookie: bob.cookie,
      body: { m: m1.id },
    });

    const forAlice = (await (
      await jsonRequest(app, '/api/chat', { cookie: alice.cookie })
    ).json()) as { conversations: { peerRead: number }[] };
    expect(forAlice.conversations[0]?.peerRead).toBe(m2.id);
  });
});

describe('WebSocket /ws (실서버 통합)', () => {
  /** 실제 Bun 서버를 띄우고 WS 클라이언트로 프로토콜 전체를 검증한다 */
  test('전송 → ack + 상대 수신 → 읽음 → 상대 읽음 알림 → 핑퐁', async () => {
    const { websocket } = await import('../../ws/hub');
    const server = Bun.serve({ port: 0, fetch: app.fetch, websocket });
    try {
      const url = `ws://localhost:${server.port}/ws`;
      const open = (cookie: string) =>
        new Promise<WebSocket>((resolve, reject) => {
          const ws = new WebSocket(url, { headers: { cookie } });
          ws.onopen = () => resolve(ws);
          ws.onerror = (e) => reject(e);
        });

      const aliceWs = await open(alice.cookie);
      const bobWs = await open(bob.cookie);

      const collect = (ws: WebSocket) => {
        const frames: Record<string, unknown>[] = [];
        ws.onmessage = (e) => frames.push(JSON.parse(String(e.data)));
        return frames;
      };
      const aliceFrames = collect(aliceWs);
      const bobFrames = collect(bobWs);

      const waitFor = async (frames: Record<string, unknown>[], type: string) => {
        for (let i = 0; i < 100; i++) {
          const found = frames.find((f) => f.t === type);
          if (found) return found;
          await new Promise((r) => setTimeout(r, 10));
        }
        throw new Error(`frame '${type}' not received`);
      };

      // 1) alice가 메시지 전송 → alice는 ack, bob은 m 프레임
      aliceWs.send(JSON.stringify({ t: 'm', c: conversationId, k: 't', x: 'ws로 안녕', i: 'tmp1' }));
      const ack = await waitFor(aliceFrames, 'a');
      expect(ack.i).toBe('tmp1');
      const received = await waitFor(bobFrames, 'm');
      expect(received).toMatchObject({ c: conversationId, s: alice.user.id, x: 'ws로 안녕' });

      // 보낸 본인 소켓에는 m 프레임이 중복 전송되면 안 된다 (ack만 받아야 함).
      // hono Bun 어댑터가 이벤트마다 WSContext를 새로 만들기 때문에 생겼던 회귀 방지.
      expect(aliceFrames.filter((f) => f.t === 'm')).toHaveLength(0);

      // 2) bob이 읽음 처리 → alice에게 r 프레임
      bobWs.send(JSON.stringify({ t: 'r', c: conversationId, m: received.id }));
      const read = await waitFor(aliceFrames, 'r');
      expect(read).toMatchObject({ c: conversationId, u: bob.user.id, m: received.id });

      // 3) 핑 → 퐁
      aliceWs.send(JSON.stringify({ t: 'p' }));
      await waitFor(aliceFrames, 'q');

      aliceWs.close();
      bobWs.close();
    } finally {
      server.stop(true);
    }
  });

  test('세션 쿠키 없이 연결하면 거부된다', async () => {
    const { websocket } = await import('../../ws/hub');
    const server = Bun.serve({ port: 0, fetch: app.fetch, websocket });
    try {
      const failed = await new Promise<boolean>((resolve) => {
        const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
        ws.onopen = () => resolve(false);
        ws.onerror = () => resolve(true);
        ws.onclose = () => resolve(true);
      });
      expect(failed).toBe(true);
    } finally {
      server.stop(true);
    }
  });
});

describe('MessagesRepo — 답장', () => {
  test('replyToId를 저장하고 WireMessage에 r로 되돌려준다', () => {
    const repo = new MessagesRepo(deps.db);
    const target = repo.insert(conversationId, alice.user.id, 't', '원본');
    const reply = repo.insert(conversationId, bob.user.id, 't', '답장', target.id);

    expect(target.r).toBeUndefined();
    expect(reply.r).toBe(target.id);
    expect(repo.findWire(reply.id)!.r).toBe(target.id);
  });

  test('listQuotes는 본문을 100자로 자른다', () => {
    const repo = new MessagesRepo(deps.db);
    const target = repo.insert(conversationId, alice.user.id, 't', 'ㄱ'.repeat(150));

    const [quote] = repo.listQuotes(conversationId, [target.id]);
    expect(quote).toEqual({ id: target.id, s: alice.user.id, k: 't', x: 'ㄱ'.repeat(100) });
  });

  // 보안 경계: 대화 ID를 조건에서 빼면 남의 대화 본문을 ID만으로 긁을 수 있다.
  test('listQuotes는 다른 대화의 메시지를 절대 반환하지 않는다', async () => {
    const carol = await signup(app, 'carol', 'Carol');
    const requested = await jsonRequest(app, '/api/friends/requests', {
      method: 'POST',
      cookie: alice.cookie,
      body: { userId: carol.user.id },
    });
    const { id: friendshipId } = (await requested.json()) as { id: number };
    const accepted = await jsonRequest(app, `/api/friends/requests/${friendshipId}/respond`, {
      method: 'POST',
      cookie: carol.cookie,
      body: { accept: true },
    });
    const otherConv = ((await accepted.json()) as { conversationId: number }).conversationId;

    const repo = new MessagesRepo(deps.db);
    const secret = repo.insert(otherConv, alice.user.id, 't', '비밀 이야기');

    expect(repo.listQuotes(conversationId, [secret.id])).toEqual([]);
  });

  test('listQuotes는 빈 배열을 받으면 빈 배열을 준다', () => {
    expect(new MessagesRepo(deps.db).listQuotes(conversationId, [])).toEqual([]);
  });
});

describe('GET /api/chat/:id/messages — refs', () => {
  /** 메시지 목록을 { messages, refs } 형태로 받는다 */
  async function fetchMessages(query: string) {
    const res = await jsonRequest(app, `/api/chat/${conversationId}/messages${query}`, {
      cookie: alice.cookie,
    });
    expect(res.status).toBe(200);
    return (await res.json()) as {
      messages: { id: number; r?: number }[];
      refs?: { id: number; x: string }[];
    };
  }

  /** REST로 답장을 보낸다 */
  async function sendReply(text: string, replyTo: number) {
    const res = await jsonRequest(app, `/api/chat/${conversationId}/messages`, {
      method: 'POST',
      cookie: bob.cookie,
      body: { k: 't', x: text, r: replyTo },
    });
    expect(res.status).toBe(201);
  }

  test('인용 대상이 같은 페이지에 있으면 refs 필드가 아예 없다', async () => {
    const target = await sendMessage(alice, '원본');
    await sendReply('답장', target.id);

    const body = await fetchMessages('?limit=30');
    expect(body.messages).toHaveLength(2);
    expect(body.refs).toBeUndefined();
  });

  test('인용 대상이 페이지 밖이면 그것만 refs에 담긴다', async () => {
    const target = await sendMessage(alice, '아주 오래된 원본');
    await sendMessage(alice, '사이 메시지');
    await sendReply('답장', target.id);

    // 마지막 1개만 받으면 원본은 페이지 밖이다.
    const body = await fetchMessages('?limit=1');
    expect(body.messages).toHaveLength(1);
    expect(body.refs).toEqual([expect.objectContaining({ id: target.id, x: '아주 오래된 원본' })]);
  });

  test('답장 셋이 같은 원본을 가리켜도 refs는 하나만 싣는다', async () => {
    const target = await sendMessage(alice, '인기 있는 원본');
    for (const text of ['답장1', '답장2', '답장3']) await sendReply(text, target.id);

    const body = await fetchMessages('?limit=3');
    expect(body.messages).toHaveLength(3);
    expect(body.refs).toHaveLength(1);
    expect(body.refs![0]!.id).toBe(target.id);
  });
});
