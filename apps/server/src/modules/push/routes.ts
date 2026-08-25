/**
 * Web Push REST 라우트: /api/push/*
 */
import { validator as zValidator } from 'hono-openapi/zod';
import {
  expoPushRegisterSchema,
  expoPushUnregisterSchema,
  pushAckSchema,
  pushSubscribeSchema,
  pushUnsubscribeSchema,
} from '@litechat/types';
import { Hono } from 'hono';
import type { AppEnv } from '../../app';
import type { AppDeps } from '../../deps';
import { requireAuth } from '../../middleware/auth';
import type { ExpoPushService } from './expo-service';
import type { NotificationLogRepo } from './notification-log-repo';
import type { PushService } from './service';

export function pushRoutes(
  deps: AppDeps,
  service: PushService,
  expo: ExpoPushService,
  notificationLog: NotificationLogRepo,
) {
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
        service.unsubscribe(c.var.userId, c.req.valid('json').endpoint);
        return c.json({ ok: true }, 200);
      })
      // 네이티브 앱 알림 켜기 — Expo Push 토큰 등록
      .post('/expo/register', zValidator('json', expoPushRegisterSchema), (c) => {
        expo.register(c.var.userId, c.req.valid('json').token);
        return c.json({ ok: true }, 201);
      })
      // 네이티브 앱 알림 끄기 — 본인 토큰만 해지된다
      .post('/expo/unregister', zValidator('json', expoPushUnregisterSchema), (c) => {
        expo.unregister(c.var.userId, c.req.valid('json').token);
        return c.json({ ok: true }, 200);
      })
      // 클라이언트가 알림을 실제로 받았을 때 보내는 ACK — n은 notification_log.id
      .post('/ack', zValidator('json', pushAckSchema), (c) => {
        const ua = c.req.header('user-agent') ?? null;
        notificationLog.markReceived(c.req.valid('json').n, c.var.userId, ua);
        return c.json({ ok: true }, 200);
      })
  );
}
