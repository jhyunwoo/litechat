/**
 * 분석 수집 REST 라우트: /api/analytics/*
 *
 * requireAuth를 붙이지 않는다 — 로그인 전 방문자도 수집 대상이기 때문이다.
 * (로그인 여부는 AnalyticsService가 세션/Bearer 토큰을 읽어 내부적으로만 반영한다)
 */
import { validator as zValidator } from 'hono-openapi/zod';
import {
  analyticsEventSchema,
  analyticsSessionSchema,
  analyticsVitalsSchema,
} from '@litechat/types';
import { Hono } from 'hono';
import type { AppEnv } from '../../app';
import type { AnalyticsService } from './service';

export function analyticsRoutes(service: AnalyticsService) {
  return new Hono<AppEnv>()
    .post('/session', zValidator('json', analyticsSessionSchema), async (c) => {
      await service.recordSession(c, c.req.valid('json'));
      return c.body(null, 204);
    })
    .post('/event', zValidator('json', analyticsEventSchema), async (c) => {
      await service.recordEvent(c, c.req.valid('json'));
      return c.body(null, 204);
    })
    .post('/vitals', zValidator('json', analyticsVitalsSchema), async (c) => {
      await service.recordVitals(c, c.req.valid('json'));
      return c.body(null, 204);
    });
}
