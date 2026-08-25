import { blockUserSchema, contentReportSchema } from '@litechat/types';
import { validator as zValidator } from 'hono-openapi/zod';
import { Hono } from 'hono';
import type { AppEnv } from '../../app';
import type { AppDeps } from '../../deps';
import { requireAuth } from '../../middleware/auth';
import { SafetyService } from './service';

export function safetyRoutes(deps: AppDeps) {
  const service = new SafetyService(deps);
  return new Hono<AppEnv>()
    .use('*', requireAuth(deps))
    .get('/blocks', (c) => c.json({ blocks: service.repo.listBlocked(c.var.userId) }, 200))
    .post('/blocks', zValidator('json', blockUserSchema), (c) => {
      service.block(c.var.userId, c.req.valid('json').userId);
      return c.json({ ok: true }, 201);
    })
    .delete('/blocks/:userId', (c) => {
      const targetId = Number(c.req.param('userId'));
      if (!Number.isSafeInteger(targetId) || targetId <= 0)
        return c.json({ error: 'BAD_REQUEST' }, 400);
      service.repo.unblock(c.var.userId, targetId);
      return c.json({ ok: true }, 200);
    })
    .post('/reports', zValidator('json', contentReportSchema), (c) => {
      const id = service.report(c.var.userId, c.req.valid('json'));
      return c.json({ id, accepted: true }, 201);
    });
}
