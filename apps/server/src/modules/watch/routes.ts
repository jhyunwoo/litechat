import { bodyLimit } from 'hono/body-limit';
import { Hono, type MiddlewareHandler } from 'hono';
import { validator as zValidator } from 'hono-openapi/zod';
import { z } from 'zod';
import {
  loginSchema,
  registerSchema,
  deleteAccountSchema,
  sendMessageSchema,
  readBodySchema,
} from '@litechat/types';
import type { AppDeps } from '../../deps';
import type { AppEnv } from '../../app';
import { errors } from '../../errors';
import { rateLimit } from '../../middleware/rate-limit';
import { AuthService } from '../auth/service';
import { destroyAllUserSessions } from '../auth/session';
import type { ChatService } from '../chat/service';
import { ImagesService } from '../images/service';
import { createWatchSession, revokeWatchSessions, validateWatchSession } from './session';
import type { WatchPushService } from './push';

const id = z.object({ id: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) });
const query = z
  .object({
    after: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    before: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(30),
    wait: z.coerce.number().int().min(0).max(25).default(0),
    pr: z.coerce.number().int().nonnegative().default(0),
    mr: z.coerce.number().int().nonnegative().default(0),
  })
  .refine(
    (q) => !(q.before !== undefined && q.after !== undefined) && (!q.wait || q.after !== undefined),
  );
const pushSchema = z
  .object({
    token: z
      .string()
      .min(2)
      .max(1024)
      .regex(/^(?:[a-fA-F0-9]{2})+$/)
      .transform((t) => t.toLowerCase()),
    environment: z.enum(['sandbox', 'production']),
  })
  .strict();
const send = sendMessageSchema.extend({ k: z.enum(['t', 'e']), i: z.string().uuid() }).strict();
const bearer = (header?: string) => /^Bearer (w_[A-Za-z0-9_-]{43})$/.exec(header ?? '')?.[1];

export function watchRoutes(deps: AppDeps, chat: ChatService, push: WatchPushService) {
  const auth = new AuthService(deps);
  const images = new ImagesService(deps);
  const requireWatch: MiddlewareHandler<AppEnv> = async (c, next) => {
    const token = bearer(c.req.header('Authorization'));
    const session = token ? await validateWatchSession(deps, token) : null;
    if (!session) return c.json({ error: 'UNAUTHORIZED' }, 401);
    c.set('userId', session.user_id);
    c.set('watchSessionId', session.id);
    c.header('Cache-Control', 'no-store');
    const limit = await deps.kv.increment(`rate:watch:${session.id}`, 60);
    if (limit.count > 120) {
      c.header('Retry-After', String(limit.retryAfter));
      return c.json({ error: 'RATE_LIMITED' }, 429);
    }
    await next();
  };
  return new Hono<AppEnv>()
    .use(
      '*',
      bodyLimit({ maxSize: 8192, onError: (c) => c.json({ error: 'BODY_TOO_LARGE' }, 413) }),
    )
    .post(
      '/auth/login',
      rateLimit(deps, { name: 'login', limit: 20, windowSeconds: 900 }),
      zValidator('json', loginSchema),
      async (c) => {
        const input = c.req.valid('json');
        const user = await auth.login(input.username, input.password);
        if (!user) return c.json({ error: 'INVALID_CREDENTIALS' }, 401);
        c.header('Cache-Control', 'no-store');
        return c.json({ user, token: await createWatchSession(deps, user.id) }, 200);
      },
    )
    .post(
      '/auth/register',
      rateLimit(deps, { name: 'register', limit: 20, windowSeconds: 3600 }),
      zValidator('json', registerSchema),
      async (c) => {
        const user = await auth.register(c.req.valid('json'));
        c.header('Cache-Control', 'no-store');
        return c.json({ user, token: await createWatchSession(deps, user.id) }, 201);
      },
    )
    .use('*', requireWatch)
    .get('/auth/me', (c) => c.json({ user: auth.getUserById(c.var.userId) }))
    .post('/auth/logout', (c) => {
      revokeWatchSessions(deps, c.var.userId, c.var.watchSessionId);
      return c.json({ ok: true });
    })
    .delete('/auth/account', zValidator('json', deleteAccountSchema), async (c) => {
      await auth.deleteAccount(c.var.userId, c.req.valid('json').password);
      await destroyAllUserSessions(deps, c.var.userId);
      deps.hub.disconnectUser(c.var.userId);
      return c.json({ ok: true });
    })
    .get('/conversations', (c) => c.json({ conversations: chat.listConversations(c.var.userId) }))
    .get(
      '/conversations/:id/messages',
      zValidator('param', id),
      zValidator('query', query),
      async (c) => {
        const conversation = c.req.valid('param').id;
        const q = c.req.valid('query');
        // Authorize before consuming a waiter. Subscribe before reading to avoid lost wakeups.
        chat.getReadState(c.var.userId, conversation);
        const subscription = q.wait
          ? deps.watchWaiters.subscribe(
              c.var.userId,
              c.var.watchSessionId,
              conversation,
              q.wait,
              c.req.raw.signal,
            )
          : undefined;
        try {
          const read = () => ({
            ...chat.getMessages(c.var.userId, conversation, q),
            ...chat.getReadState(c.var.userId, conversation),
          });
          let data = read();
          if (
            subscription &&
            !data.messages.length &&
            data.peerRead === q.pr &&
            data.read === q.mr
          ) {
            await subscription.promise;
            if (c.req.raw.signal.aborted) return new Response(null, { status: 499 });
            if (!(await validateWatchSession(deps, bearer(c.req.header('Authorization'))!)))
              return c.json({ error: 'UNAUTHORIZED' }, 401);
            data = read();
          }
          const acks: { i: string; id: number }[] = [];
          for (const m of data.messages)
            if (m.s === c.var.userId) {
              const row = deps.db
                .query<{ i: string | null }, [number]>(
                  'SELECT watch_request_id i FROM messages WHERE id=?',
                )
                .get(m.id);
              if (row?.i) acks.push({ i: row.i, id: m.id });
            }
          return c.json({ ...data, ...(acks.length ? { acks } : {}) });
        } finally {
          subscription?.cancel();
        }
      },
    )
    .post('/conversations/:id/messages', zValidator('param', id), zValidator('json', send), (c) => {
      const { i, k, x, r } = c.req.valid('json');
      return c.json(
        {
          i,
          message: chat.sendMessage(c.var.userId, c.req.valid('param').id, k, x, undefined, r, i),
        },
        201,
      );
    })
    .post(
      '/conversations/:id/read',
      zValidator('param', id),
      zValidator('json', readBodySchema),
      (c) => {
        const conversation = c.req.valid('param').id;
        const m = c.req.valid('json').m;
        const target = chat.getMessages(c.var.userId, conversation, { after: m - 1, limit: 1 })
          .messages[0];
        if (target?.id !== m) throw errors.badRequest('INVALID_WATERMARK');
        return c.json(chat.markRead(c.var.userId, conversation, m));
      },
    )
    .get(
      '/images/:id/thumb',
      zValidator('param', z.object({ id: z.string().min(1).max(64) })),
      (c) => {
        const file = images.getFile(c.var.userId, c.req.valid('param').id, 'thumb');
        return new Response(Bun.file(file.path), {
          headers: { 'Content-Type': file.contentType, 'Cache-Control': 'no-store' },
        });
      },
    )
    .post('/push/register', zValidator('json', pushSchema), (c) => {
      const { token, environment } = c.req.valid('json');
      push.register(c.var.userId, c.var.watchSessionId, token, environment);
      return c.json({ ok: true }, 201);
    })
    .delete('/push/register', (c) => {
      push.unregister(c.var.userId, c.var.watchSessionId);
      return c.json({ ok: true });
    });
}
