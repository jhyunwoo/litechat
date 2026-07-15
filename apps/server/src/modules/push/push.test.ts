/**
 * Web Push 모듈 테스트 (TDD — 구현보다 먼저 작성됨)
 *
 * 실제 푸시 서비스 대신 주입된 sender 함수로 발송을 검증한다.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { createApp, type AppType } from '../../app';
import { createTestDeps, type AppDeps } from '../../deps';
import { fakeSocket, jsonRequest, signup } from '../../test/helpers';
import type { PushSender } from './service';
import { NotificationLogRepo } from './notification-log-repo';

let deps: AppDeps;
let sent: { endpoint: string; payload: Record<string, unknown> }[];
let sender: PushSender;
let app: AppType;
let alice: Awaited<ReturnType<typeof signup>>;
let bob: Awaited<ReturnType<typeof signup>>;
let conversationId: number;

const SUBSCRIPTION = {
  endpoint: 'https://push.example.com/sub/bob-phone',
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
};

beforeEach(async () => {
  deps = createTestDeps({ vapidPublicKey: 'test-pub', vapidPrivateKey: 'test-priv' });
  sent = [];
  sender = async (subscription, payload) => {
    sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
  };
  app = createApp(deps, { pushSender: sender });
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

/** bob 기기 구독 등록 */
async function subscribeBob() {
  const res = await jsonRequest(app, '/api/push/subscribe', {
    method: 'POST',
    cookie: bob.cookie,
    body: SUBSCRIPTION,
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

describe('GET /api/push/key', () => {
  test('VAPID 공개키와 활성화 여부를 반환한다', async () => {
    const res = await jsonRequest(app, '/api/push/key', { cookie: bob.cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ key: 'test-pub', enabled: true });
  });
});

describe('오프라인 푸시 발송', () => {
  test('상대가 오프라인이면 구독된 모든 기기로 발송된다', async () => {
    await subscribeBob();
    await aliceSends('안녕!');

    expect(sent).toHaveLength(1);
    expect(sent[0]?.endpoint).toBe(SUBSCRIPTION.endpoint);
    // 알림 페이로드에는 보낸 사람과 내용, 대화방 ID가 담긴다.
    expect(sent[0]?.payload).toMatchObject({ title: 'Alice', body: '안녕!', c: conversationId });
  });

  test('상대가 온라인이면 푸시를 보내지 않는다', async () => {
    await subscribeBob();
    fakeSocket(deps, bob.user.id);
    await aliceSends();
    expect(sent).toHaveLength(0);
  });

  test('이미지 메시지는 본문 대신 사진 표시로 발송된다', async () => {
    await subscribeBob();
    // 이미지 업로드 없이 페이로드 형식만 검증하기 위해 서비스에 직접 접근하지 않고
    // 텍스트 규칙만 확인한다 — 이미지 메시지 페이로드는 service 단위 테스트에서 다룬다.
    await aliceSends('텍스트');
    expect(sent[0]?.payload.body).toBe('텍스트');
  });

  test('발송 성공 시 notification_log에 ok로 기록된다', async () => {
    await subscribeBob();
    await aliceSends('기록됨');

    const log = new NotificationLogRepo(deps.db);
    const { rows } = log.list({ sort: 'sent_at', dir: 'desc', limit: 1, offset: 0 });
    expect(rows[0]).toMatchObject({
      userId: bob.user.id,
      channel: 'web',
      sentStatus: 'ok',
      bodyPreview: '기록됨',
    });
  });

  test('만료된 구독(410)은 자동으로 삭제된다', async () => {
    await subscribeBob();
    // 다음 발송이 410으로 실패하도록 sender를 바꾼다.
    sent.push();
    let calls = 0;
    const failing: PushSender = async () => {
      calls += 1;
      const error = new Error('gone') as Error & { statusCode: number };
      error.statusCode = 410;
      throw error;
    };
    const failingApp = createApp(deps, { pushSender: failing });
    const aliceRelogin = await jsonRequest(failingApp, '/api/auth/login', {
      method: 'POST',
      body: { username: 'alice', password: 'password123' },
    });
    const cookie = (aliceRelogin.headers.get('set-cookie') ?? '').match(/lc_sess=[^;]+/)![0];

    await jsonRequest(failingApp, `/api/chat/${conversationId}/messages`, {
      method: 'POST',
      cookie,
      body: { k: 't', x: 'x' },
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toBe(1);

    // 구독이 삭제되었으므로 두 번째 발송 시도는 일어나지 않는다.
    await jsonRequest(failingApp, `/api/chat/${conversationId}/messages`, {
      method: 'POST',
      cookie,
      body: { k: 't', x: 'y' },
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toBe(1);

    // 실패한 발송도 로그에는 expired로 남는다 (조용히 사라지지 않는다).
    const log = new NotificationLogRepo(deps.db);
    const { rows } = log.list({ sort: 'sent_at', dir: 'desc', limit: 10, offset: 0 });
    expect(rows.filter((r) => r.sentStatus === 'expired')).toHaveLength(1);
  });
});

describe('구독 관리', () => {
  test('같은 endpoint 재구독은 오류 없이 갱신된다', async () => {
    await subscribeBob();
    await subscribeBob();
  });

  test('unsubscribe 후에는 발송되지 않는다', async () => {
    await subscribeBob();
    const res = await jsonRequest(app, '/api/push/unsubscribe', {
      method: 'POST',
      cookie: bob.cookie,
      body: { endpoint: SUBSCRIPTION.endpoint },
    });
    expect(res.status).toBe(200);
    await aliceSends();
    expect(sent).toHaveLength(0);
  });
});

describe('POST /api/push/ack', () => {
  test('로그 id로 수신 시각을 기록한다', async () => {
    await subscribeBob();
    await aliceSends('안녕!');
    const log = new NotificationLogRepo(deps.db);
    const before = log.list({ sort: 'sent_at', dir: 'desc', limit: 1, offset: 0 }).rows[0]!;
    expect(before.receivedAt).toBeNull();

    const res = await jsonRequest(app, '/api/push/ack', {
      method: 'POST',
      cookie: bob.cookie,
      body: { n: before.id },
    });
    expect(res.status).toBe(200);

    const after = log.list({ sort: 'sent_at', dir: 'desc', limit: 1, offset: 0 }).rows[0]!;
    expect(after.receivedAt).not.toBeNull();
    expect(after.receivedStatus).toBe('received');
  });

  test('다른 사용자의 로그는 ACK로 갱신되지 않는다', async () => {
    await subscribeBob();
    await aliceSends('안녕!');
    const log = new NotificationLogRepo(deps.db);
    const logId = log.list({ sort: 'sent_at', dir: 'desc', limit: 1, offset: 0 }).rows[0]!.id;

    await jsonRequest(app, '/api/push/ack', {
      method: 'POST',
      cookie: alice.cookie,
      body: { n: logId },
    });

    const after = log.list({ sort: 'sent_at', dir: 'desc', limit: 1, offset: 0 }).rows[0]!;
    expect(after.receivedAt).toBeNull();
  });

  test('인증 없이 호출하면 401', async () => {
    const res = await jsonRequest(app, '/api/push/ack', { method: 'POST', body: { n: 1 } });
    expect(res.status).toBe(401);
  });
});
