import type { WireMessage } from '@litechat/types';
import type { AppDeps } from '../../deps';
import { errors } from '../../errors';
import { MessagesRepo } from '../chat/messages-repo';
import { messageNotification } from '../push/message-notification';
import { APNsProvider, type WatchPushSender } from './apns';

export class WatchPushService {
  private provider: APNsProvider;
  private sender: WatchPushSender;
  private running: Promise<void> | undefined;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private deps: AppDeps,
    sender?: WatchPushSender,
  ) {
    this.provider = new APNsProvider(deps.config);
    this.sender = sender ?? this.provider.send;
  }
  register(user: number, session: string, token: string, environment: 'sandbox' | 'production') {
    const now = Date.now();
    this.deps.db.transaction(() => {
      const other = this.deps.db
        .query<{ user_id: number; session_id: string }, [string, string]>(
          'SELECT user_id,session_id FROM watch_push_tokens WHERE token=? AND environment=?',
        )
        .get(token, environment);
      // A claimed token never moves to another account through an arbitrary registration.
      if (other && other.user_id !== user) throw errors.conflict('TOKEN_ALREADY_REGISTERED');
      if (other?.session_id === session) {
        this.deps.db
          .query('UPDATE watch_push_tokens SET registered_at=? WHERE session_id=?')
          .run(now, session);
        return;
      }
      if (other) {
        // Same account reauthentication on this installation: keep pending deliveries.
        this.deps.db.query('DELETE FROM watch_push_tokens WHERE session_id=?').run(session);
        this.deps.db
          .query(
            'UPDATE watch_push_tokens SET session_id=?,registered_at=? WHERE token=? AND environment=?',
          )
          .run(session, now, token, environment);
        return;
      }
      const current = this.deps.db
        .query('SELECT id FROM watch_push_tokens WHERE session_id=?')
        .get(session);
      if (current) {
        this.deps.db
          .query(
            'UPDATE watch_push_tokens SET token=?,environment=?,registered_at=? WHERE session_id=?',
          )
          .run(token, environment, now, session);
        return;
      }
      const count = this.deps.db
        .query<{ n: number }, [number]>('SELECT COUNT(*) n FROM watch_push_tokens WHERE user_id=?')
        .get(user)!.n;
      if (count >= 10) throw errors.badRequest('DEVICE_LIMIT');
      this.deps.db
        .query(
          'INSERT INTO watch_push_tokens(session_id,user_id,token,environment,registered_at) VALUES(?,?,?,?,?)',
        )
        .run(session, user, token, environment, now);
    })();
  }
  unregister(user: number, session: string) {
    this.deps.db
      .query('DELETE FROM watch_push_tokens WHERE user_id=? AND session_id=?')
      .run(user, session);
  }
  hasDevices(user: number) {
    return !!this.deps.db
      .query(
        `SELECT 1 FROM watch_push_tokens p JOIN watch_sessions s ON s.id=p.session_id
      WHERE p.user_id=? AND s.revoked=0 AND s.expires_at>? LIMIT 1`,
      )
      .get(user, Math.floor(Date.now() / 1000));
  }
  /** Called inside the message transaction. Durable jobs survive provider/server failures. */
  enqueue(user: number, message: WireMessage) {
    const now = Math.floor(Date.now() / 1000);
    const tokens = this.deps.db
      .query<{ id: number }, [number, number]>(
        `SELECT p.id FROM watch_push_tokens p JOIN watch_sessions s ON s.id=p.session_id
      WHERE p.user_id=? AND s.revoked=0 AND s.expires_at>?`,
      )
      .all(user, now);
    for (const p of tokens)
      this.deps.db
        .query(
          `INSERT OR IGNORE INTO watch_push_jobs(token_id,message_id,request_id,due_at,expires_at) VALUES(?,?,?,?,?)`,
        )
        .run(p.id, message.id, crypto.randomUUID(), now, now + 86400);
    // Runs after the synchronous transaction commits. No network inside SQLite transaction.
    if (tokens.length)
      queueMicrotask(() => {
        void this.flush();
      });
  }
  flush() {
    if (this.stopped) return Promise.resolve();
    if (this.running) return this.running;
    this.running = this.drain()
      .catch(() => {
        console.error('[watch-push] dispatch failed');
      })
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }
  private async drain() {
    const now = Math.floor(Date.now() / 1000);
    const rows = this.deps.db
      .query<
        {
          id: number;
          token_id: number;
          message_id: number;
          request_id: string;
          attempts: number;
          expires_at: number;
          token: string;
          environment: 'sandbox' | 'production';
          registered_at: number;
        },
        [number, number]
      >(
        `
      SELECT j.*,p.token,p.environment,p.registered_at FROM watch_push_jobs j
      JOIN watch_push_tokens p ON p.id=j.token_id JOIN watch_sessions s ON s.id=p.session_id
      WHERE j.status='pending' AND j.due_at<=? AND s.revoked=0 AND s.expires_at>? ORDER BY j.id LIMIT 100`,
      )
      .all(now, now);
    for (const job of rows) {
      if (this.stopped) break;
      // Recheck after prior network awaits: account deletion/logout may have removed a job.
      if (!this.deps.db.query('SELECT 1 FROM watch_push_jobs WHERE id=?').get(job.id)) continue;
      if (job.expires_at <= now) {
        this.fail(job.id, 'Expired');
        continue;
      }
      const message = new MessagesRepo(this.deps.db).findWire(job.message_id);
      if (!message) {
        this.fail(job.id, 'MessageGone');
        continue;
      }
      const sender = this.deps.db
        .query<{ nickname: string }, [number]>('SELECT nickname FROM users WHERE id=?')
        .get(message.s);
      const recipient = this.deps.db
        .query<{ user_id: number }, [number]>('SELECT user_id FROM watch_push_tokens WHERE id=?')
        .get(job.token_id);
      if (!sender || !recipient) continue;
      if (
        this.deps.db
          .query(
            'SELECT 1 FROM user_blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)',
          )
          .get(message.s, recipient.user_id, recipient.user_id, message.s)
      ) {
        this.fail(job.id, 'Blocked');
        continue;
      }
      const n = messageNotification(sender, message);
      let result;
      try {
        result = await this.sender({
          token: job.token,
          environment: job.environment,
          requestId: job.request_id,
          expiration: job.expires_at,
          payload: {
            aps: {
              alert: { title: n.title, body: n.body },
              sound: 'default',
              category: n.category,
              'thread-id': n.thread,
            },
            c: n.c,
            m: n.m,
          },
        });
      } catch {
        result = { status: 503, reason: 'TransportError' };
      }
      if (this.stopped) break;
      const currentToken = this.deps.db
        .query<{ token: string; environment: string }, [number]>(
          'SELECT token,environment FROM watch_push_tokens WHERE id=?',
        )
        .get(job.token_id);
      if (
        !currentToken ||
        currentToken.token !== job.token ||
        currentToken.environment !== job.environment
      )
        continue;
      if (result.status === 200)
        this.deps.db
          .query(
            "UPDATE watch_push_jobs SET status='accepted',attempts=attempts+1,reason=NULL WHERE id=?",
          )
          .run(job.id);
      else if (result.reason === 'BadDeviceToken' || result.reason === 'Unregistered') {
        // Timestamp is milliseconds since epoch. Never prune a newer registration.
        this.deps.db
          .query('DELETE FROM watch_push_tokens WHERE id=? AND registered_at<=?')
          .run(job.token_id, result.timestamp ?? job.registered_at);
        this.fail(job.id, result.reason);
      } else if ((result.status === 429 || result.status >= 500) && job.attempts < 5) {
        const delay = Math.ceil(Math.min(300, 2 ** (job.attempts + 1)) * (0.5 + Math.random() / 2));
        this.deps.db
          .query('UPDATE watch_push_jobs SET attempts=attempts+1,due_at=?,reason=? WHERE id=?')
          .run(now + delay, result.reason ?? 'TransientError', job.id);
      } else this.fail(job.id, result.reason ?? `HTTP_${result.status}`);
    }
  }
  private fail(id: number, reason: string) {
    this.deps.db
      .query("UPDATE watch_push_jobs SET status='failed',reason=?,attempts=attempts+1 WHERE id=?")
      .run(reason, id);
  }
  start() {
    const tick = async () => {
      await this.flush();
      if (!this.stopped) this.timer = setTimeout(tick, 5000);
    };
    void tick();
    return async () => {
      this.stopped = true;
      clearTimeout(this.timer);
      this.provider.close();
      await this.running;
    };
  }
}
