import { beforeEach, afterEach, expect, test } from 'bun:test';
import { createTestDeps, type AppDeps } from '../../deps';
import { createApp } from '../../app';
import { signup, jsonRequest } from '../../test/helpers';
import { WatchPushService } from './push';
import { createWatchSession, validateWatchSession } from './session';
import { ChatService } from '../chat/service';
import type { APNsResult, WatchPush } from './apns';
let deps: AppDeps;
let service: WatchPushService;
let user: number;
let peer: number;
let c: number;
let session: string;
let result: APNsResult;
let calls: WatchPush[];
let chat: ChatService;
beforeEach(async () => {
  deps = createTestDeps();
  const app = createApp(deps);
  user = (await signup(app, 'alice')).user.id;
  peer = (await signup(app, 'bob')).user.id;
  c = Number(
    deps.db
      .query('INSERT INTO conversations(user_a,user_b,created_at) VALUES(?,?,0)')
      .run(user, peer).lastInsertRowid,
  );
  const token = await createWatchSession(deps, peer);
  session = (await validateWatchSession(deps, token))!.id;
  result = { status: 200 };
  calls = [];
  service = new WatchPushService(deps, async (p) => {
    calls.push(p);
    return result;
  });
  service.register(peer, session, 'abcd', 'sandbox');
  chat = new ChatService(deps, undefined, (p, m) => service.enqueue(p, m));
});
afterEach(async () => {
  await service.flush();
  deps.db.close();
  await deps.kv.close();
});
test('APNs accepted is recorded without claiming device receipt', async () => {
  chat.sendMessage(user, c, 't', 'hello');
  await service.flush();
  expect(calls).toHaveLength(1);
  expect(calls[0]!.payload.aps.alert.title).toBe('alice');
  expect(deps.db.query('SELECT status,attempts FROM watch_push_jobs').get()).toEqual({
    status: 'accepted',
    attempts: 1,
  });
});
test.each(['BadDeviceToken', 'Unregistered'])(
  '%s prunes the invalid registration',
  async (reason) => {
    result = { status: reason === 'Unregistered' ? 410 : 400, reason };
    chat.sendMessage(user, c, 't', 'hello');
    await service.flush();
    expect(deps.db.query('SELECT * FROM watch_push_tokens').all()).toHaveLength(0);
  },
);
test('transient failure survives as a due job and retry succeeds', async () => {
  result = { status: 503, reason: 'ServiceUnavailable' };
  chat.sendMessage(user, c, 't', 'hello');
  await service.flush();
  expect(deps.db.query('SELECT status,attempts FROM watch_push_jobs').get()).toEqual({
    status: 'pending',
    attempts: 1,
  });
  result = { status: 200 };
  deps.db.query('UPDATE watch_push_jobs SET due_at=0').run();
  await service.flush();
  expect(calls).toHaveLength(2);
  expect(calls[0]!.requestId).toBe(calls[1]!.requestId);
});
test('same token registration preserves pending jobs', async () => {
  result = { status: 503 };
  chat.sendMessage(user, c, 't', 'hello');
  await service.flush();
  service.register(peer, session, 'abcd', 'sandbox');
  expect(deps.db.query('SELECT * FROM watch_push_jobs').all()).toHaveLength(1);
});
test('multiple Watches get their own jobs', async () => {
  const other = (await validateWatchSession(deps, await createWatchSession(deps, peer)))!;
  service.register(peer, other.id, 'aabbcc', 'production');
  chat.sendMessage(user, c, 't', 'hello');
  await service.flush();
  expect(calls).toHaveLength(2);
  expect(new Set(calls.map((p) => p.token)).size).toBe(2);
});
test('provider configuration errors do not delete valid tokens', async () => {
  result = { status: 403, reason: 'InvalidProviderToken' };
  chat.sendMessage(user, c, 't', 'hello');
  await service.flush();
  expect(deps.db.query('SELECT * FROM watch_push_tokens').all()).toHaveLength(1);
  expect(deps.db.query('SELECT status FROM watch_push_jobs').get()).toEqual({ status: 'failed' });
});
test('delayed Unregistered cannot prune a newer registration', async () => {
  result = { status: 410, reason: 'Unregistered', timestamp: 1 };
  chat.sendMessage(user, c, 't', 'hello');
  await service.flush();
  expect(deps.db.query('SELECT * FROM watch_push_tokens').all()).toHaveLength(1);
});
test('Expo and Watch fan out with the same message content', async () => {
  const expo: any[] = [];
  const app = createApp(deps, {
    watchPushService: service,
    expoPushSender: async (messages) => {
      expo.push(...messages);
      return messages.map(() => ({ status: 'ok' }));
    },
  });
  const login = await jsonRequest(app, '/api/auth/login', {
    method: 'POST',
    body: { username: 'alice', password: 'password123' },
  });
  deps.db
    .query('INSERT INTO expo_push_tokens(user_id,token,created_at) VALUES(?,?,0)')
    .run(peer, 'ExpoPushToken[test]');
  await jsonRequest(app, `/api/chat/${c}/messages`, {
    method: 'POST',
    token: ((await login.json()) as any).token,
    body: { k: 't', x: 'fanout' },
  });
  await service.flush();
  expect(expo).toHaveLength(1);
  expect(calls).toHaveLength(1);
  expect(expo[0].title).toBe(calls[0]!.payload.aps.alert.title);
  expect(expo[0].body).toBe(calls[0]!.payload.aps.alert.body);
  expect(expo[0].data.m).toBe(calls[0]!.payload.m);
  expect(expo[0].threadId).toBe(calls[0]!.payload.aps['thread-id']);
});
test('rotated tokens retain pending jobs and retries target the new token', async () => {
  result = { status: 503 };
  chat.sendMessage(user, c, 't', 'rotate');
  await service.flush();
  service.register(peer, session, '112233', 'sandbox');
  result = { status: 200 };
  deps.db.query('UPDATE watch_push_jobs SET due_at=0').run();
  await service.flush();
  expect(calls[1]!.token).toBe('112233');
  expect(deps.db.query('SELECT status FROM watch_push_jobs').get()).toEqual({ status: 'accepted' });
});
