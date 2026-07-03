/**
 * 친구 모듈 테스트 (TDD — 구현보다 먼저 작성됨)
 *
 * 시나리오: 검색 → 친구 요청 → 수락/거절 → 친구 목록 + 대화방 생성 + 실시간 알림
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { createApp, type AppType } from '../../app';
import { createTestDeps, type AppDeps } from '../../deps';
import { fakeSocket, jsonRequest, signup } from '../../test/helpers';

let deps: AppDeps;
let app: AppType;
let alice: Awaited<ReturnType<typeof signup>>;
let bob: Awaited<ReturnType<typeof signup>>;

beforeEach(async () => {
  deps = createTestDeps();
  app = createApp(deps);
  alice = await signup(app, 'alice', 'Alice');
  bob = await signup(app, 'bob', 'Bob');
});

/** alice → bob 친구 요청을 보내고 friendship id를 반환한다 */
async function sendRequest(from = alice, to = bob): Promise<number> {
  const res = await jsonRequest(app, '/api/friends/requests', {
    method: 'POST',
    cookie: from.cookie,
    body: { userId: to.user.id },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

describe('GET /api/friends/search', () => {
  test('아이디 전방 일치로 검색되고 관계 상태가 표시된다', async () => {
    await signup(app, 'bobby', 'Bobby');
    const res = await jsonRequest(app, '/api/friends/search?q=bob', { cookie: alice.cookie });
    expect(res.status).toBe(200);
    const { users } = (await res.json()) as {
      users: { username: string; rel: string }[];
    };
    expect(users.map((u) => u.username)).toEqual(['bob', 'bobby']);
    expect(users[0]?.rel).toBe('none');
  });

  test('자기 자신은 rel=self로 표시된다', async () => {
    const res = await jsonRequest(app, '/api/friends/search?q=alice', { cookie: alice.cookie });
    const { users } = (await res.json()) as { users: { rel: string }[] };
    expect(users[0]?.rel).toBe('self');
  });

  test('로그인하지 않으면 401', async () => {
    const res = await jsonRequest(app, '/api/friends/search?q=bob');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/friends/requests', () => {
  test('요청을 보내면 상대에게 실시간 f/req 프레임이 전송된다', async () => {
    const bobSocket = fakeSocket(deps, bob.user.id);
    await sendRequest();
    expect(bobSocket.frames).toContainEqual({
      t: 'f',
      k: 'req',
      u: { id: alice.user.id, username: 'alice', nickname: 'Alice' },
    });
  });

  test('자기 자신에게는 요청할 수 없다 (400)', async () => {
    const res = await jsonRequest(app, '/api/friends/requests', {
      method: 'POST',
      cookie: alice.cookie,
      body: { userId: alice.user.id },
    });
    expect(res.status).toBe(400);
  });

  test('이미 관계가 있으면 409 (반대 방향 포함)', async () => {
    await sendRequest();
    const res = await jsonRequest(app, '/api/friends/requests', {
      method: 'POST',
      cookie: bob.cookie,
      body: { userId: alice.user.id },
    });
    expect(res.status).toBe(409);
  });

  test('존재하지 않는 사용자면 404', async () => {
    const res = await jsonRequest(app, '/api/friends/requests', {
      method: 'POST',
      cookie: alice.cookie,
      body: { userId: 9999 },
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/friends/requests', () => {
  test('받은/보낸 요청이 구분되어 조회된다', async () => {
    await sendRequest();
    const forBob = (await (
      await jsonRequest(app, '/api/friends/requests', { cookie: bob.cookie })
    ).json()) as { incoming: { user: { username: string } }[]; outgoing: unknown[] };
    expect(forBob.incoming).toHaveLength(1);
    expect(forBob.incoming[0]?.user.username).toBe('alice');
    expect(forBob.outgoing).toHaveLength(0);

    const forAlice = (await (
      await jsonRequest(app, '/api/friends/requests', { cookie: alice.cookie })
    ).json()) as { incoming: unknown[]; outgoing: unknown[] };
    expect(forAlice.outgoing).toHaveLength(1);
  });
});

describe('POST /api/friends/requests/:id/respond', () => {
  test('수락하면 친구가 되고 대화방이 생성되며 요청자에게 f/acc가 전송된다', async () => {
    const aliceSocket = fakeSocket(deps, alice.user.id);
    const requestId = await sendRequest();

    const res = await jsonRequest(app, `/api/friends/requests/${requestId}/respond`, {
      method: 'POST',
      cookie: bob.cookie,
      body: { accept: true },
    });
    expect(res.status).toBe(200);
    const { conversationId } = (await res.json()) as { conversationId: number };
    expect(conversationId).toBeGreaterThan(0);

    // 요청자(alice)에게 수락 알림 + 대화방 ID가 실시간으로 전달된다.
    expect(aliceSocket.frames).toContainEqual({
      t: 'f',
      k: 'acc',
      u: { id: bob.user.id, username: 'bob', nickname: 'Bob' },
      c: conversationId,
    });

    // 양쪽 모두 친구 목록에 서로가 보인다.
    const friends = (await (
      await jsonRequest(app, '/api/friends', { cookie: alice.cookie })
    ).json()) as { friends: { user: { username: string }; c: number }[] };
    expect(friends.friends).toHaveLength(1);
    expect(friends.friends[0]?.user.username).toBe('bob');
    expect(friends.friends[0]?.c).toBe(conversationId);
  });

  test('거절하면 관계가 삭제되어 다시 요청할 수 있다', async () => {
    const requestId = await sendRequest();
    const res = await jsonRequest(app, `/api/friends/requests/${requestId}/respond`, {
      method: 'POST',
      cookie: bob.cookie,
      body: { accept: false },
    });
    expect(res.status).toBe(200);

    // 다시 요청 가능해야 한다.
    await sendRequest();
  });

  test('수신자가 아닌 사람은 응답할 수 없다 (404)', async () => {
    const requestId = await sendRequest();
    // 요청자 본인(alice)이 수락 시도 → 거부
    const res = await jsonRequest(app, `/api/friends/requests/${requestId}/respond`, {
      method: 'POST',
      cookie: alice.cookie,
      body: { accept: true },
    });
    expect(res.status).toBe(404);
  });

  test('이미 처리된 요청에는 응답할 수 없다 (404)', async () => {
    const requestId = await sendRequest();
    await jsonRequest(app, `/api/friends/requests/${requestId}/respond`, {
      method: 'POST',
      cookie: bob.cookie,
      body: { accept: true },
    });
    const res = await jsonRequest(app, `/api/friends/requests/${requestId}/respond`, {
      method: 'POST',
      cookie: bob.cookie,
      body: { accept: true },
    });
    expect(res.status).toBe(404);
  });
});
