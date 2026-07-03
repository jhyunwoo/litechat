/**
 * Web Push REST 라우트: /api/push/*
 */
import { validator as zValidator } from 'hono-openapi/zod';
import { pushSubscribeSchema, pushUnsubscribeSchema } from '@litechat/types';
import { Hono } from 'hono';
import type { AppEnv } from '../../app';
import type { AppDeps } from '../../deps';
import { requireAuth } from '../../middleware/auth';
import type { PushService } from './service';

export function pushRoutes(deps: AppDeps, service: PushService) {
  return (
    new Hono<AppEnv>()
      .use('*', requireAuth(deps))
      // 구독에 필요한 VAPID 공개키 + 기능 활성화 여부
      .get('/key', (c) => c.json({ key: service.publicKey, enabled: service.enabled }, 200))
      // 알림 켜기 — 브라우저 PushSubscription 등록
      .post('/subscribe', zValidator('json', pushSubscribeSchema), (c) => {
        service.subscribe(c.var.userId, c.req.valid('json'));
        return c.json({ ok: true }, 201);
      })
      // 알림 끄기
      .post('/unsubscribe', zValidator('json', pushUnsubscribeSchema), (c) => {
        service.unsubscribe(c.req.valid('json').endpoint);
        return c.json({ ok: true }, 200);
      })
  );
}
