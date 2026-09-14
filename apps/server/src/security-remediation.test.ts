import { afterEach, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import sharp from 'sharp';
import { createApp } from './app';
import { createTestDeps, type AppDeps } from './deps';
import { signup, jsonRequest } from './test/helpers';
import { isPushEndpoint } from './modules/push/endpoint';
import { PushRepo } from './modules/push/repo';
import { PushService } from './modules/push/service';
import { NotificationLogRepo } from './modules/push/notification-log-repo';
import { ImagesService } from './modules/images/service';
import { websocket } from './ws/hub';

const resources: AppDeps[] = [];
function setup(overrides: Parameters<typeof createTestDeps>[0] = {}) {
  const deps = createTestDeps(overrides);
  resources.push(deps);
  return { deps, app: createApp(deps) };
}
afterEach(async () => {
  for (const deps of resources.splice(0)) {
    deps.hub.closeAll();
    deps.watchWaiters.close();
    deps.db.close();
    await deps.kv.close();
    await rm(deps.config.uploadDir, { recursive: true, force: true });
  }
});

test('push endpoints reject internal targets, credentials and provider lookalikes', () => {
  for (const endpoint of [
    'http://169.254.169.254/',
    'https://127.0.0.1/',
    'https://[::1]/',
    'https://redis:6379/',
    'https://fcm.googleapis.com.evil.test/',
    'https://fcm.googleapis.com@evil.test/',
    'https://fcm.googleapis.com:444/',
    'https://evil.test/#https://fcm.googleapis.com',
    'https://fcm.googleapis.com/#x',
  ])
    expect(isPushEndpoint(endpoint)).toBe(false);
  for (const host of [
    'fcm.googleapis.com',
    'updates.push.services.mozilla.com',
    'web.push.apple.com',
  ])
    expect(isPushEndpoint(`https://${host}/subscription`)).toBe(true);
});

test('push registration and legacy stored endpoints cannot reach an arbitrary sender', async () => {
  const { deps, app } = setup();
  const alice = await signup(app, 'alice');
  const response = await jsonRequest(app, '/api/push/subscribe', {
    method: 'POST',
    cookie: alice.cookie,
    body: { endpoint: 'https://127.0.0.1/', keys: { p256dh: 'key', auth: 'key' } },
  });
  expect(response.status).toBe(400);
  new PushRepo(deps.db).upsert(alice.user.id, 'https://127.0.0.1/', 'key', 'key');
  let calls = 0;
  const service = new PushService(deps, new NotificationLogRepo(deps.db), async () => {
    calls++;
  });
  service.offlineHook(
    alice.user.id,
    { ...alice.user, nickname: 'Alice' },
    { id: 1, c: 1, s: alice.user.id, k: 't', x: 'hello', ts: 1 },
  );
  await Promise.resolve();
  expect(calls).toBe(0);
});

test('production cookie is host protected and legacy domain cookie is not accepted', async () => {
  const { app } = setup({ isProduction: true, cookieDomain: '.moveto.kr' });
  const response = await jsonRequest(app, '/api/auth/register', {
    method: 'POST',
    body: { username: 'alice', nickname: 'Alice', password: 'password123' },
  });
  const cookie = response.headers.get('set-cookie')!;
  expect(cookie).toContain('__Host-lc_sess=');
  expect(cookie).toContain('Secure');
  expect(cookie).not.toContain('Domain=');
  expect(response.headers.get('cache-control')).toBe('no-store');
  const { token } = (await response.json()) as { token: string };
  expect(
    (await app.request('/api/auth/me', { headers: { cookie: `lc_sess=${token}` } })).status,
  ).toBe(401);
  expect(
    (await app.request('/api/auth/me', { headers: { cookie: `__Host-lc_sess=${token}` } })).status,
  ).toBe(200);
});

test('sibling origins cannot logout or upgrade using cookies; same-origin and native remain supported', async () => {
  const { app } = setup();
  const alice = await signup(app, 'alice');
  for (const path of ['/api/auth/logout', '/api/admin/logout', '/ws']) {
    const response = await app.request(`http://chat.moveto.kr${path}`, {
      method: path === '/ws' ? 'GET' : 'POST',
      headers: { cookie: alice.cookie, Origin: 'http://evil.moveto.kr' },
    });
    expect(response.status).toBe(403);
  }
  expect(
    (
      await app.request('http://chat.moveto.kr/api/auth/logout', {
        method: 'POST',
        headers: { cookie: alice.cookie, Origin: 'http://chat.moveto.kr' },
      })
    ).status,
  ).toBe(200);
  const native = await signup(app, 'native');
  expect((await jsonRequest(app, '/api/auth/me', { token: native.token })).status).toBe(200);
});

test('oversized bodies are rejected before multipart parsing', async () => {
  const { app } = setup();
  const alice = await signup(app, 'alice');
  const response = await app.request('/api/images', {
    method: 'POST',
    headers: { cookie: alice.cookie, 'Content-Type': 'multipart/form-data; boundary=x' },
    body: new Uint8Array(11 * 1024 * 1024 + 1),
  });
  expect(response.status).toBe(413);
});

test('image storage quota and concurrent decoding are enforced across service instances', async () => {
  const { deps, app } = setup({ uploadUserQuotaBytes: 1 });
  const alice = await signup(app, 'alice');
  const bytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'blue' } })
    .png()
    .toBuffer();
  const file = new File([new Uint8Array(bytes)], 'image.png');
  const first = new ImagesService(deps).upload(alice.user.id, file);
  await expect(new ImagesService(deps).upload(alice.user.id, file)).rejects.toThrow('UPLOAD_BUSY');
  await expect(first).rejects.toThrow('UPLOAD_QUOTA_EXCEEDED');
  expect(deps.db.query('SELECT COUNT(*) n FROM images').get()).toEqual({ n: 0 });
  deps.config.uploadUserQuotaBytes = 1024 * 1024;
  deps.config.uploadTotalQuotaBytes = 1;
  await expect(new ImagesService(deps).upload(alice.user.id, file)).rejects.toThrow(
    'UPLOAD_QUOTA_EXCEEDED',
  );
  deps.config.uploadTotalQuotaBytes = 1024 * 1024;
  expect((await new ImagesService(deps).upload(alice.user.id, file)).id).toBeTruthy();
});

test('image upload rate limits reject work before decoding', async () => {
  const { deps, app } = setup();
  const alice = await signup(app, 'alice');
  await deps.kv.set(`rate:image-user:${alice.user.id}`, '100', 3600);
  const response = await app.request('/api/images', {
    method: 'POST',
    headers: { cookie: alice.cookie },
  });
  expect(response.status).toBe(429);
  expect(response.headers.get('retry-after')).toBeTruthy();
  expect(deps.db.query('SELECT COUNT(*) n FROM images').get()).toEqual({ n: 0 });
});

test('logout closes existing sockets for that session while another device stays connected', async () => {
  const { deps, app } = setup();
  const alice = await signup(app, 'alice');
  const login = await jsonRequest(app, '/api/auth/login', {
    method: 'POST',
    body: { username: 'alice', password: 'password123' },
  });
  const { token: otherToken } = (await login.json()) as { token: string };
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch, websocket });
  const sockets: WebSocket[] = [];
  try {
    async function connect(token: string) {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      sockets.push(ws);
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = reject;
      });
      const pong = new Promise<void>((resolve) => {
        ws.onmessage = () => resolve();
      });
      ws.send('{"t":"p"}');
      await pong;
      return ws;
    }
    const first = await connect(alice.token);
    const other = await connect(otherToken);
    const closed = new Promise<void>((resolve) => {
      first.onclose = () => resolve();
    });
    await jsonRequest(app, '/api/auth/logout', { method: 'POST', token: alice.token });
    await closed;
    expect(first.readyState).toBe(WebSocket.CLOSED);
    expect(other.readyState).toBe(WebSocket.OPEN);
    expect(deps.hub.socketCount).toBe(1);
  } finally {
    for (const ws of sockets) ws.close();
    await server.stop(true);
  }
});
