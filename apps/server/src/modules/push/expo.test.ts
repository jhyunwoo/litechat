/**
 * Expo Push 모듈 테스트
 *
 * 실제 Expo Push API 대신 주입된 sender 함수로 발송을 검증한다.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { createApp, type AppType } from '../../app';
import { createTestDeps, type AppDeps } from '../../deps';
import { fakeSocket, jsonRequest, signup } from '../../test/helpers';
import type { ExpoPushMessage, ExpoPushSender } from './expo-service';

const TOKEN = 'ExponentPushToken[bob-iphone-000000000000]';

let deps: AppDeps;
let sent: ExpoPushMessage[][];
let sender: ExpoPushSender;
let app: AppType;
let alice: Awaited<ReturnType<typeof signup>>;
let bob: Awaited<ReturnType<typeof signup>>;
let conversationId: number;

beforeEach(async () => {
  deps = createTestDeps();
  sent = [];
  sender = async (messages) => {
    sent.push(messages);
    return messages.map((_, i) => ({ status: 'ok' as const, id: `ticket-${sent.length}-${i}` }));
  };
  app = createApp(deps, { expoPushSender: sender });
  alice = await signup(app, 'alice', 'Alice');
  bob = await signup(app, 'bob', 'Bob');

  // 친구 + 대화방 준비
  const req = await jsonRequest(app, '/api/friends/requests', {
    method: 'POST',
    cookie: alice.cookie,
    body: { userId: bob.user.id },
  });
  const { id } = (await req.json()) as { id: number };
  const acc = await jsonRequest(app, `/api/friends/requests/${id}/respond`, {
    method: 'POST',
    cookie: bob.cookie,
    body: { accept: true },
  });
  conversationId = ((await acc.json()) as { conversationId: number }).conversationId;
});

/** bob 기기 토큰 등록 (Bearer 인증 — 네이티브 앱 경로 그대로) */
async function registerBob(token = TOKEN) {
  const res = await jsonRequest(app, '/api/push/expo/register', {
    method: 'POST',
    token: bob.token,
    body: { token },
  });
  expect(res.status).toBe(201);
}

/** alice → bob 메시지 전송 */
async function aliceSends(text = '푸시 테스트') {
  const res = await jsonRequest(app, `/api/chat/${conversationId}/messages`, {
    method: 'POST',
    cookie: alice.cookie,
    body: { k: 't', x: text },
  });
  expect(res.status).toBe(201);
  // 오프라인 훅은 비동기 fire-and-forget이므로 마이크로태스크를 비운다.
  await new Promise((r) => setTimeout(r, 10));
}

describe('POST /api/push/expo/register', () => {
  test('형식이 잘못된 토큰은 400을 반환한다', async () => {
    for (const bad of ['not-a-token', 'ExponentPushToken[]', 'ExponentPushToken[a b]', '']) {
      const res = await jsonRequest(app, '/api/push/expo/register', {
        method: 'POST',
        token: bob.token,
        body: { token: bad },
      });
      expect(res.status).toBe(400);
    }
  });

  test('인증 없이 등록하면 401을 반환한다', async () => {
    const res = await jsonRequest(app, '/api/push/expo/register', {
      method: 'POST',
      body: { token: TOKEN },
    });
    expect(res.status).toBe(401);
  });

  test('같은 토큰 재등록은 오류 없이 갱신된다', async () => {
    await registerBob();
    await registerBob();
  });

  test('다른 사용자가 같은 토큰을 등록하면 소유자가 바뀐다 (기기 단위 토큰)', async () => {
    await registerBob();
    // alice가 같은 기기(토큰)로 로그인해 등록
    const res = await jsonRequest(app, '/api/push/expo/register', {
      method: 'POST',
      token: alice.token,
      body: { token: TOKEN },
    });
    expect(res.status).toBe(201);

    // bob이 오프라인이어도 이제 bob에게는 발송되지 않는다.
    await aliceSends();
    expect(sent).toHaveLength(0);
  });

  test('사용자당 토큰은 10개로 제한된다 (초과분은 오래된 것부터 삭제)', async () => {
    for (let i = 0; i < 12; i += 1) {
      await registerBob(`ExponentPushToken[bob-device-${i}]`);
    }
    await aliceSends();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(10);
    // 가장 오래된 0, 1번 기기는 정리되었다.
    const tos = sent[0]!.map((m) => m.to);
    expect(tos).not.toContain('ExponentPushToken[bob-device-0]');
    expect(tos).toContain('ExponentPushToken[bob-device-11]');
  });
});

describe('오프라인 Expo 푸시 발송', () => {
  test('상대가 오프라인이면 등록된 기기로 발송된다 (제목/본문/딥링크/배지)', async () => {
    await registerBob();
    await aliceSends('안녕!');

    expect(sent).toHaveLength(1);
    expect(sent[0]![0]).toMatchObject({
      to: TOKEN,
      title: 'Alice',
      body: '안녕!',
      data: { c: conversationId },
      sound: 'default',
      badge: 1, // bob의 전체 안읽음 수
    });
  });

  test('배지는 전체 안읽음 수를 반영한다', async () => {
    await registerBob();
    await aliceSends('1');
    await aliceSends('2');
    expect(sent[1]![0]!.badge).toBe(2);
  });

  test('상대가 온라인이면 발송하지 않는다', async () => {
    await registerBob();
    fakeSocket(deps, bob.user.id);
    await aliceSends();
    expect(sent).toHaveLength(0);
  });

  test('DeviceNotRegistered 티켓을 받으면 토큰이 삭제된다', async () => {
    let calls = 0;
    const failing: ExpoPushSender = async (messages) => {
      calls += 1;
      return messages.map(() => ({
        status: 'error' as const,
        details: { error: 'DeviceNotRegistered' },
      }));
    };
    const failingApp = createApp(deps, { expoPushSender: failing });
    const login = await jsonRequest(failingApp, '/api/auth/login', {
      method: 'POST',
      body: { username: 'bob', password: 'password123' },
    });
    const bobToken = ((await login.json()) as { token: string }).token;
    await jsonRequest(failingApp, '/api/push/expo/register', {
      method: 'POST',
      token: bobToken,
      body: { token: TOKEN },
    });

    const aliceLogin = await jsonRequest(failingApp, '/api/auth/login', {
      method: 'POST',
      body: { username: 'alice', password: 'password123' },
    });
    const aliceToken = ((await aliceLogin.json()) as { token: string }).token;
    const send = () =>
      jsonRequest(failingApp, `/api/chat/${conversationId}/messages`, {
        method: 'POST',
        token: aliceToken,
        body: { k: 't', x: 'x' },
      });

    await send();
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toBe(1);

    // 토큰이 삭제되었으므로 두 번째 발송 시도는 일어나지 않는다.
    await send();
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toBe(1);
  });

  test('웹푸시와 Expo 푸시 훅이 함께 동작한다', async () => {
    const webSent: string[] = [];
    const bothApp = createApp(
      { ...deps, config: { ...deps.config, vapidPublicKey: 'pub', vapidPrivateKey: 'priv' } },
      {
        pushSender: async (sub) => {
          webSent.push(sub.endpoint);
        },
        expoPushSender: sender,
      },
    );
    const login = await jsonRequest(bothApp, '/api/auth/login', {
      method: 'POST',
      body: { username: 'bob', password: 'password123' },
    });
    const bobToken = ((await login.json()) as { token: string }).token;
    await jsonRequest(bothApp, '/api/push/expo/register', {
      method: 'POST',
      token: bobToken,
      body: { token: TOKEN },
    });
    await jsonRequest(bothApp, '/api/push/subscribe', {
      method: 'POST',
      token: bobToken,
      body: { endpoint: 'https://push.example.com/bob', keys: { p256dh: 'k', auth: 'a' } },
    });

    await jsonRequest(bothApp, `/api/chat/${conversationId}/messages`, {
      method: 'POST',
      cookie: alice.cookie,
      body: { k: 't', x: '둘 다' },
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(webSent).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });
});

describe('POST /api/push/expo/unregister', () => {
  test('해지 후에는 발송되지 않는다', async () => {
    await registerBob();
    const res = await jsonRequest(app, '/api/push/expo/unregister', {
      method: 'POST',
      token: bob.token,
      body: { token: TOKEN },
    });
    expect(res.status).toBe(200);
    await aliceSends();
    expect(sent).toHaveLength(0);
  });

  test('남의 토큰은 해지할 수 없다 (소유권 검사)', async () => {
    await registerBob();
    // alice가 bob의 토큰 해지를 시도
    const res = await jsonRequest(app, '/api/push/expo/unregister', {
      method: 'POST',
      token: alice.token,
      body: { token: TOKEN },
    });
    expect(res.status).toBe(200); // 요청 자체는 성공하지만 아무것도 지워지지 않는다
    await aliceSends();
    expect(sent).toHaveLength(1); // bob에게 여전히 발송된다
  });
});
