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
import type { AppDeps } from '../../deps';
import { rateLimit } from '../../middleware/rate-limit';
import type { AnalyticsService } from './service';

export function analyticsRoutes(deps: AppDeps, service: AnalyticsService) {
  return new Hono<AppEnv>()
    // 수집 엔드포인트는 인증이 없다(로그인 전 방문자도 대상). 클라이언트가 보낸
    // visitorId/sessionId를 그대로 행 키로 쓰므로, 상한이 없으면 익명 요청만으로
    // analytics_* 테이블을 무한히 부풀릴 수 있다. 정상 클라이언트의 실제 전송량
    // (세션당 몇 건)보다 넉넉하되 자동화된 남용은 막는 선으로 제한한다.
    .use('*', rateLimit(deps, { name: 'analytics', limit: 240, windowSeconds: 600 }))
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
