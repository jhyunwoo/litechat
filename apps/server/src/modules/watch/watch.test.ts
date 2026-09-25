import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createApp } from '../../app';
import { createTestDeps, type AppDeps } from '../../deps';
import { jsonRequest, signup, fakeSocket } from '../../test/helpers';

let deps: AppDeps;
let app: ReturnType<typeof createApp>;
let alice: Awaited<ReturnType<typeof signup>>;
let bob: Awaited<ReturnType<typeof signup>>;
let token: string;
let c: number;
const pushes: any[] = [];
beforeEach(async () => {
  deps = createTestDeps();
  pushes.length = 0;
  app = createApp(deps, {
    watchPushSender: async (p: any) => {
      pushes.push(p);
      return { status: 200 };
    },
  });
  alice = await signup(app, 'alice');
  bob = await signup(app, 'bob');
  const req = await jsonRequest(app, '/api/friends/requests', {
    method: 'POST',
    token: alice.token,
    body: { userId: bob.user.id },
  });
  const acc = await jsonRequest(
    app,
    `/api/friends/requests/${((await req.json()) as any).id}/respond`,
    { method: 'POST', token: bob.token, body: { accept: true } },
  );
  c = ((await acc.json()) as any).conversationId;
  const login = await jsonRequest(app, '/api/watch/auth/login', {
    method: 'POST',
    body: { username: 'bob', password: 'password123' },
  });
  expect(login.status).toBe(200);
  token = ((await login.json()) as any).token;
});
afterEach(async () => {
  deps.db.close();
  await deps.kv.close();
});
const request = (path: string, method = 'GET', body?: unknown, t = token) =>
  jsonRequest(app, '/api/watch' + path, { method, token: t, body });

describe('independent Watch', () => {
  test('logs in without phone credentials and cannot use general APIs', async () => {
    expect((await request('/auth/me')).status).toBe(200);
    for (const path of ['/api/auth/me', '/api/friends', '/api/chat', '/api/admin/me']) {
      expect((await jsonRequest(app, path, { token })).status).not.toBe(200);
    }
    expect((await request('/auth/me', 'GET', undefined, bob.token)).status).toBe(401);
    expect((await request('/conversations')).status).toBe(200);
  });
  test('phone session exchanges once for a watch-scoped session', async () => {
    const res = await request('/auth/exchange', 'POST', undefined, bob.token);
    expect(res.status).toBe(200);
    const exchanged = ((await res.json()) as any).token;
    expect(exchanged).toMatch(/^w_[A-Za-z0-9_-]{43}$/);
    expect((await request('/auth/me', 'GET', undefined, exchanged)).status).toBe(200);
    // The phone credential itself is still not a watch credential.
    expect((await request('/auth/me', 'GET', undefined, bob.token)).status).toBe(401);
    // Ending the phone session ends future exchanges, not the issued token.
    await jsonRequest(app, '/api/auth/logout', { method: 'POST', token: bob.token });
    expect((await request('/auth/exchange', 'POST', undefined, bob.token)).status).toBe(401);
    expect((await request('/auth/me', 'GET', undefined, exchanged)).status).toBe(200);
  });
  test('standalone registration returns only a Watch session', async () => {
    const res = await request(
      '/auth/register',
      'POST',
      { username: 'carol', password: 'password123', nickname: 'Carol' },
      '',
    );
    expect(res.status).toBe(201);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
  test('idempotent text/emoji retry returns one canonical message', async () => {
    const i = crypto.randomUUID();
    const first = await request(`/conversations/${c}/messages`, 'POST', { i, k: 'e', x: '👋' });
    expect(first.status).toBe(201);
    const a = (await first.json()) as any;
    const b = (await (
      await request(`/conversations/${c}/messages`, 'POST', { i, k: 'e', x: '👋' })
    ).json()) as any;
    expect(b.message.id).toBe(a.message.id);
    expect(
      (await request(`/conversations/${c}/messages`, 'POST', { i, k: 't', x: 'different' })).status,
    ).toBe(409);
    const messages = (await (await request(`/conversations/${c}/messages?after=0`)).json()) as any;
    expect(messages.messages).toHaveLength(1);
    expect(messages.acks).toContainEqual({ i, id: a.message.id });
  });
  test('cannot guess conversations or upload images', async () => {
    expect((await request('/conversations/999999/messages')).status).toBe(404);
    expect(
      (
        await request(`/conversations/${c}/messages`, 'POST', {
          i: crypto.randomUUID(),
          k: 'i',
          x: 'image',
        })
      ).status,
    ).toBe(400);
  });
  test('direct Watch push dispatch with zero Expo tokens, even with a live phone socket', async () => {
    const registered = await request('/push/register', 'POST', {
      token: 'abcdef12',
      environment: 'sandbox',
    });
    expect(registered.status).toBe(201);
    fakeSocket(deps, bob.user.id);
    await jsonRequest(app, `/api/chat/${c}/messages`, {
      method: 'POST',
      token: alice.token,
      body: { k: 't', x: 'hello watch' },
    });
    await Bun.sleep(30);
    expect(pushes).toHaveLength(1);
    expect(pushes[0].payload.aps.alert.body).toBe('hello watch');
    expect(pushes[0].payload.c).toBe(c);
  });
  test('logout removes Watch push and revokes session', async () => {
    await request('/push/register', 'POST', { token: 'abcdef12', environment: 'sandbox' });
    expect((await request('/auth/logout', 'POST')).status).toBe(200);
    expect((await request('/auth/me')).status).toBe(401);
    expect(deps.db.query('SELECT * FROM watch_push_tokens').all()).toHaveLength(0);
  });
  test('account deletion on phone invalidates Watch and tokens', async () => {
    await request('/push/register', 'POST', { token: 'abcdef12', environment: 'sandbox' });
    expect(
      (
        await jsonRequest(app, '/api/auth/account', {
          method: 'DELETE',
          token: bob.token,
          body: { password: 'password123' },
        })
      ).status,
    ).toBe(200);
    expect((await request('/auth/me')).status).toBe(401);
    expect(deps.db.query('SELECT * FROM watch_push_tokens').all()).toHaveLength(0);
  });
});

describe('Watch authorization and polling', () => {
  test('rejects bad login and unauthorized token registration', async () => {
    expect(
      (await request('/auth/login', 'POST', { username: 'bob', password: 'incorrect123' }, ''))
        .status,
    ).toBe(401);
    expect(
      (await request('/push/register', 'POST', { token: 'abcd', environment: 'sandbox' }, ''))
        .status,
    ).toBe(401);
    for (const body of [
      { token: 'xyz', environment: 'sandbox' },
      { token: 'abc', environment: 'sandbox' },
      { token: 'abcd', environment: 'other' },
      { token: 'abcd', environment: 'sandbox', userId: alice.user.id },
    ])
      expect((await request('/push/register', 'POST', body)).status).toBe(400);
  });
  test('expires without needing a phone-issued replacement session', async () => {
    deps.db.query('UPDATE watch_sessions SET expires_at=0').run();
    expect((await request('/auth/me')).status).toBe(401);
    const login = await request(
      '/auth/login',
      'POST',
      { username: 'bob', password: 'password123' },
      '',
    );
    expect(login.status).toBe(200);
  });
  test('foreign conversation access and read watermark guessing are forbidden', async () => {
    const login = await request(
      '/auth/register',
      'POST',
      { username: 'eve', password: 'password123', nickname: 'Eve' },
      '',
    );
    const eve = ((await login.json()) as any).token;
    expect((await request(`/conversations/${c}/messages`, 'GET', undefined, eve)).status).toBe(403);
    expect(
      (
        await request(
          `/conversations/${c}/messages`,
          'POST',
          { i: crypto.randomUUID(), k: 't', x: 'intrude' },
          eve,
        )
      ).status,
    ).toBe(403);
    expect((await request(`/conversations/${c}/read`, 'POST', { m: 999999 })).status).toBe(400);
  });
  test('recent/older/incremental pages use the canonical message order', async () => {
    for (let i = 0; i < 4; i++)
      await request(`/conversations/${c}/messages`, 'POST', {
        i: crypto.randomUUID(),
        k: 't',
        x: `${i}`,
      });
    const recent = (await (await request(`/conversations/${c}/messages?limit=2`)).json()) as any;
    expect(recent.messages.map((m: any) => m.x)).toEqual(['2', '3']);
    const older = (await (
      await request(`/conversations/${c}/messages?before=${recent.messages[0].id}&limit=2`)
    ).json()) as any;
    expect(older.messages.map((m: any) => m.x)).toEqual(['0', '1']);
    const after = (await (
      await request(`/conversations/${c}/messages?after=${older.messages[1].id}`)
    ).json()) as any;
    expect(after.messages).toEqual(recent.messages);
  });
  test('long poll immediately returns existing messages and cleans waiters', async () => {
    await request(`/conversations/${c}/messages`, 'POST', {
      i: crypto.randomUUID(),
      k: 't',
      x: 'ready',
    });
    const response = await request(`/conversations/${c}/messages?after=0&wait=20`);
    expect(((await response.json()) as any).messages).toHaveLength(1);
    expect(deps.watchWaiters.size).toBe(0);
  });
  test('long poll wakes on a message from the existing phone REST path', async () => {
    const poll = request(`/conversations/${c}/messages?after=0&wait=20`);
    await Bun.sleep(10);
    expect(deps.watchWaiters.size).toBe(1);
    await jsonRequest(app, `/api/chat/${c}/messages`, {
      method: 'POST',
      token: alice.token,
      body: { k: 't', x: 'wake' },
    });
    expect(((await (await poll).json()) as any).messages[0].x).toBe('wake');
    expect(deps.watchWaiters.size).toBe(0);
  });
  test('read-only changes wake long polls', async () => {
    const sent = (await (
      await request(`/conversations/${c}/messages`, 'POST', {
        i: crypto.randomUUID(),
        k: 't',
        x: 'read me',
      })
    ).json()) as any;
    const poll = request(`/conversations/${c}/messages?after=${sent.message.id}&wait=20`);
    await Bun.sleep(10);
    await jsonRequest(app, `/api/chat/${c}/read`, {
      method: 'POST',
      token: alice.token,
      body: { m: sent.message.id },
    });
    const response = (await (await poll).json()) as any;
    expect(response.messages).toHaveLength(0);
    expect(response.peerRead).toBe(sent.message.id);
    expect(deps.watchWaiters.size).toBe(0);
  });
  test('bounded timeout returns JSON and cleans waiters', async () => {
    const started = Date.now();
    const poll = await request(`/conversations/${c}/messages?after=0&wait=1`);
    expect(((await poll.json()) as any).messages).toEqual([]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect(deps.watchWaiters.size).toBe(0);
  });
  test('disconnect cancels and frees the waiter', async () => {
    const controller = new AbortController();
    const poll = app.request(`/api/watch/conversations/${c}/messages?after=0&wait=20`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    await Bun.sleep(10);
    controller.abort();
    expect((await poll).status).toBe(499);
    expect(deps.watchWaiters.size).toBe(0);
  });
  test('only one long poll per session; revocation wakes and rejects the pending request', async () => {
    const poll = request(`/conversations/${c}/messages?after=0&wait=20`);
    await Bun.sleep(10);
    expect((await request(`/conversations/${c}/messages?after=0&wait=20`)).status).toBe(429);
    await request('/auth/logout', 'POST');
    expect((await poll).status).toBe(401);
    expect(deps.watchWaiters.size).toBe(0);
  });
  test('global revocation invalidates Watch tokens', async () => {
    const { destroyAllUserSessions } = await import('../auth/session');
    await destroyAllUserSessions(deps, bob.user.id);
    expect((await request('/auth/me')).status).toBe(401);
  });
  test('registration cannot steal another account token; unregister is session-local', async () => {
    await request('/push/register', 'POST', { token: 'abcd', environment: 'sandbox' });
    const a = await request(
      '/auth/login',
      'POST',
      { username: 'alice', password: 'password123' },
      '',
    );
    const at = ((await a.json()) as any).token;
    expect(
      (await request('/push/register', 'POST', { token: 'abcd', environment: 'sandbox' }, at))
        .status,
    ).toBe(409);
    await request('/push/register', 'DELETE', undefined, at);
    expect(deps.db.query('SELECT * FROM watch_push_tokens').all()).toHaveLength(1);
    await request('/push/register', 'POST', { token: '123456', environment: 'sandbox' });
    expect(deps.db.query('SELECT token FROM watch_push_tokens').all()).toEqual([
      { token: '123456' },
    ]);
  });
});

test('Watch receives image metadata and authorized thumbnail bytes', async () => {
  const path = deps.config.uploadDir + '/watch-test.webp';
  await Bun.write(path, 'thumbnail');
  deps.db
    .query(
      `INSERT INTO images(id,owner_id,orig_path,webp_path,orig_bytes,webp_bytes,width,height,created_at) VALUES('watch-image',?,?,?,9,9,10,10,0)`,
    )
    .run(alice.user.id, path, path);
  const sent = await jsonRequest(app, `/api/chat/${c}/messages`, {
    method: 'POST',
    token: alice.token,
    body: { k: 'i', x: 'watch-image' },
  });
  expect(sent.status).toBe(201);
  const messages = (await (await request(`/conversations/${c}/messages`)).json()) as any;
  expect(messages.messages[0].im.id).toBe('watch-image');
  const image = await request('/images/watch-image/thumb');
  expect(await image.text()).toBe('thumbnail');
  expect(image.headers.get('content-type')).toBe('image/webp');
  const eve = (await (
    await request(
      '/auth/register',
      'POST',
      { username: 'eve', password: 'password123', nickname: 'Eve' },
      '',
    )
  ).json()) as any;
  expect((await request('/images/watch-image/thumb', 'GET', undefined, eve.token)).status).toBe(
    403,
  );
});

test('Watch account deletion requires password and removes all device access', async () => {
  expect((await request('/auth/account', 'DELETE', { password: 'badpassword' })).status).toBe(401);
  expect((await request('/auth/account', 'DELETE', { password: 'password123' })).status).toBe(200);
  expect((await request('/auth/me')).status).toBe(401);
  expect((await jsonRequest(app, '/api/auth/me', { token: bob.token })).status).toBe(401);
});

test('Watch session record contains a hash, timestamps and platform, not the credential', () => {
  const row = deps.db.query('SELECT * FROM watch_sessions').get() as any;
  expect(row.platform).toBe('watchOS');
  expect(row.id).not.toBe(token);
  expect(row.created_at).toBeGreaterThan(0);
  expect(row.expires_at).toBeGreaterThan(row.last_activity);
  expect(JSON.stringify(row)).not.toContain(token);
});
