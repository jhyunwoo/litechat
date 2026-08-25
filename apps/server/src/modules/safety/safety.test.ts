import { beforeEach, describe, expect, test } from 'bun:test';
import { createApp, type AppType } from '../../app';
import { createTestDeps, type AppDeps } from '../../deps';
import { jsonRequest, signup } from '../../test/helpers';

let deps: AppDeps;
let app: AppType;
let alice: Awaited<ReturnType<typeof signup>>;
let bob: Awaited<ReturnType<typeof signup>>;
let conversationId: number;

beforeEach(async () => {
  deps = createTestDeps();
  app = createApp(deps);
  alice = await signup(app, 'alice');
  bob = await signup(app, 'bob');
  const request = await jsonRequest(app, '/api/friends/requests', {
    method: 'POST',
    token: alice.token,
    body: { userId: bob.user.id },
  });
  const requestId = ((await request.json()) as { id: number }).id;
  const accepted = await jsonRequest(app, `/api/friends/requests/${requestId}/respond`, {
    method: 'POST',
    token: bob.token,
    body: { accept: true },
  });
  conversationId = ((await accepted.json()) as { conversationId: number }).conversationId;
});

describe('UGC report and block enforcement', () => {
  test('accessible message report reaches moderation queue', async () => {
    const sent = await jsonRequest(app, `/api/chat/${conversationId}/messages`, {
      method: 'POST',
      token: bob.token,
      body: { k: 't', x: 'unsafe content' },
    });
    const messageId = ((await sent.json()) as { message: { id: number } }).message.id;
    const report = await jsonRequest(app, '/api/safety/reports', {
      method: 'POST',
      token: alice.token,
      body: { userId: bob.user.id, messageId, reason: 'harassment' },
    });
    expect(report.status).toBe(201);
    expect(
      deps.db
        .query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM content_reports WHERE status = 'open'",
        )
        .get()?.count,
    ).toBe(1);
  });

  test('blocking is two-way and hides friendship, conversation, search, messages, and images', async () => {
    const block = await jsonRequest(app, '/api/safety/blocks', {
      method: 'POST',
      token: alice.token,
      body: { userId: bob.user.id },
    });
    expect(block.status).toBe(201);
    expect(
      (await (await jsonRequest(app, '/api/safety/blocks', { token: alice.token })).json()) as {
        blocks: unknown[];
      },
    ).toMatchObject({ blocks: [{ user: { id: bob.user.id } }] });
    expect(
      (await (await jsonRequest(app, '/api/friends', { token: alice.token })).json()) as {
        friends: unknown[];
      },
    ).toEqual({ friends: [] });
    expect(
      (await (await jsonRequest(app, '/api/chat', { token: bob.token })).json()) as {
        conversations: unknown[];
      },
    ).toEqual({ conversations: [] });
    expect(
      (await jsonRequest(app, `/api/chat/${conversationId}/messages`, { token: alice.token }))
        .status,
    ).toBe(403);
    const search = await jsonRequest(app, '/api/friends/search?q=bob', { token: alice.token });
    expect(await search.json()).toEqual({ users: [] });
  });

  test('cannot attach an inaccessible message as report evidence', async () => {
    const charlie = await signup(app, 'charlie');
    const sent = await jsonRequest(app, `/api/chat/${conversationId}/messages`, {
      method: 'POST',
      token: bob.token,
      body: { k: 't', x: 'private' },
    });
    const messageId = ((await sent.json()) as { message: { id: number } }).message.id;
    const report = await jsonRequest(app, '/api/safety/reports', {
      method: 'POST',
      token: charlie.token,
      body: { userId: bob.user.id, messageId, reason: 'spam' },
    });
    expect(report.status).toBe(404);
  });
});
