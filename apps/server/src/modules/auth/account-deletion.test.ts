import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../../app';
import { createTestDeps } from '../../deps';
import { jsonRequest, signup } from '../../test/helpers';

describe('DELETE /api/auth/account', () => {
  test('reauthenticates, deletes all associated records/files, and invalidates every session', async () => {
    const deps = createTestDeps();
    const app = createApp(deps);
    const alice = await signup(app, 'alice');
    const bob = await signup(app, 'bob');
    const secondLogin = await jsonRequest(app, '/api/auth/login', {
      method: 'POST',
      body: { username: 'alice', password: 'password123' },
    });
    const secondToken = ((await secondLogin.json()) as { token: string }).token;

    const request = await jsonRequest(app, '/api/friends/requests', {
      method: 'POST',
      token: alice.token,
      body: { userId: bob.user.id },
    });
    const accepted = await jsonRequest(
      app,
      `/api/friends/requests/${((await request.json()) as { id: number }).id}/respond`,
      { method: 'POST', token: bob.token, body: { accept: true } },
    );
    const conversationId = ((await accepted.json()) as { conversationId: number }).conversationId;
    const message = await jsonRequest(app, `/api/chat/${conversationId}/messages`, {
      method: 'POST',
      token: alice.token,
      body: { k: 't', x: 'delete me' },
    });
    const messageId = ((await message.json()) as { message: { id: number } }).message.id;

    const origPath = join(deps.config.uploadDir, 'delete-orig.png');
    const webpPath = join(deps.config.uploadDir, 'delete-thumb.webp');
    await Bun.write(origPath, 'image');
    await Bun.write(webpPath, 'thumb');
    deps.db
      .query(
        `INSERT INTO images (id, owner_id, orig_path, webp_path, orig_bytes, webp_bytes, width, height, created_at) VALUES ('image1', ?, ?, ?, 5, 5, 1, 1, 1)`,
      )
      .run(alice.user.id, origPath, webpPath);
    deps.db
      .query(
        `INSERT INTO content_reports (reporter_id, reported_user_id, message_id, reason, created_at) VALUES (?, ?, ?, 'spam', 1)`,
      )
      .run(bob.user.id, alice.user.id, messageId);
    deps.db
      .query(`INSERT INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, 1)`)
      .run(alice.user.id, bob.user.id);
    deps.db
      .query(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, 'https://push.example/alice', 'p', 'a', 1)`,
      )
      .run(alice.user.id);
    deps.db
      .query(
        `INSERT INTO expo_push_tokens (user_id, token, created_at) VALUES (?, 'ExpoPushToken[alice]', 1)`,
      )
      .run(alice.user.id);
    deps.db
      .query(
        `INSERT INTO analytics_sessions (id, visitor_id, user_id, platform, ip, created_at, last_seen_at) VALUES ('session1', 'visitor1', ?, 'app', '127.0.0.1', 1, 1)`,
      )
      .run(alice.user.id);
    deps.db
      .query(
        `INSERT INTO analytics_events (session_id, path, created_at) VALUES ('session1', '/', 1)`,
      )
      .run();
    deps.db
      .query(
        `INSERT INTO notification_log (user_id, channel, conversation_id, sent_at, sent_status) VALUES (?, 'expo', ?, 1, 'ok')`,
      )
      .run(alice.user.id, conversationId);
    deps.db
      .query('INSERT INTO insights_watch (user_id, created_at) VALUES (?, 1)')
      .run(alice.user.id);

    const wrong = await jsonRequest(app, '/api/auth/account', {
      method: 'DELETE',
      token: alice.token,
      body: { password: 'wrongpass' },
    });
    expect(wrong.status).toBe(401);
    const deleted = await jsonRequest(app, '/api/auth/account', {
      method: 'DELETE',
      token: alice.token,
      body: { password: 'password123' },
    });
    expect(deleted.status).toBe(200);

    for (const [table, column] of [
      ['users', 'id'],
      ['friendships', 'requester_id'],
      ['conversations', 'user_a'],
      ['images', 'owner_id'],
      ['push_subscriptions', 'user_id'],
      ['expo_push_tokens', 'user_id'],
      ['analytics_sessions', 'user_id'],
      ['notification_log', 'user_id'],
      ['insights_watch', 'user_id'],
    ] as const) {
      expect(
        deps.db
          .query<{ count: number }, [number]>(
            `SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`,
          )
          .get(alice.user.id)?.count,
      ).toBe(0);
    }
    expect(
      deps.db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM messages').get()?.count,
    ).toBe(0);
    expect(
      deps.db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM content_reports').get()
        ?.count,
    ).toBe(0);
    expect(existsSync(origPath)).toBe(false);
    expect(existsSync(webpPath)).toBe(false);
    expect((await jsonRequest(app, '/api/auth/me', { token: alice.token })).status).toBe(401);
    expect((await jsonRequest(app, '/api/auth/me', { token: secondToken })).status).toBe(401);
    expect((await jsonRequest(app, '/api/auth/me', { token: bob.token })).status).toBe(200);
  });
});
