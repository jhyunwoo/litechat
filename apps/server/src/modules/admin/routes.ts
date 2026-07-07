/**
 * 관리자 REST 라우트: /api/admin/*
 *
 * 로그인/로그아웃/내 정보는 공개, 나머지 조회 엔드포인트는 requireAdmin으로 보호한다.
 * 분석 데이터 자체는 admin 모듈이 소유하지 않고 AnalyticsService.queries(AnalyticsRepo)에
 * 위임한다 — 데이터 접근 로직을 두 모듈에 중복하지 않기 위해서다.
 */
import { validator as zValidator } from 'hono-openapi/zod';
import { adminLoginSchema } from '@litechat/types';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppDeps } from '../../deps';
import { requireAdmin } from '../../middleware/admin-auth';
import { probeGeoip } from '../analytics/geoip';
import type { AnalyticsService } from '../analytics/service';
import { AdminRepo } from './repo';
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  createAdminSession,
  destroyAdminSession,
} from './session';

/** 관리자 라우트 전용 컨텍스트 변수 — 채팅 라우트의 AppEnv(userId)와 분리된 타입 */
export interface AppAdminVariables {
  adminId: number;
}
export type AppAdminEnv = { Variables: AppAdminVariables };

/** 관리자 세션 쿠키 공통 속성 — 호스트 전용(Domain 미지정)으로 다른 서브도메인에 노출되지 않는다 */
function cookieOptions(deps: AppDeps) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax' as const,
    secure: deps.config.isProduction,
  };
}

export function adminRoutes(deps: AppDeps, analyticsService: AnalyticsService) {
  const repo = new AdminRepo(deps.db);

  return new Hono<AppAdminEnv>()
    .post('/login', zValidator('json', adminLoginSchema), async (c) => {
      const { username, password } = c.req.valid('json');
      const row = repo.findByUsername(username);
      if (!row) return c.json({ error: 'INVALID_CREDENTIALS' }, 401);
      const valid = await Bun.password.verify(password, row.password_hash);
      if (!valid) return c.json({ error: 'INVALID_CREDENTIALS' }, 401);

      const token = await createAdminSession(deps, row.id);
      setCookie(c, ADMIN_SESSION_COOKIE, token, {
        ...cookieOptions(deps),
        maxAge: ADMIN_SESSION_TTL_SECONDS,
      });
      return c.json({ ok: true }, 200);
    })
    .post('/logout', async (c) => {
      const token = getCookie(c, ADMIN_SESSION_COOKIE);
      if (token) await destroyAdminSession(deps, token);
      deleteCookie(c, ADMIN_SESSION_COOKIE, cookieOptions(deps));
      return c.json({ ok: true }, 200);
    })
    .get('/me', requireAdmin(deps), (c) => {
      const admin = repo.findById(c.var.adminId);
      if (!admin) return c.json({ error: 'UNAUTHORIZED' }, 401);
      return c.json({ admin }, 200);
    })
    .get('/overview', requireAdmin(deps), (c) => {
      const days = Number(c.req.query('days') ?? 30);
      return c.json(analyticsService.queries.overview(days), 200);
    })
    .get('/timeseries', requireAdmin(deps), (c) => {
      const days = Number(c.req.query('days') ?? 30);
      return c.json(analyticsService.queries.timeseries(days), 200);
    })
    .get('/geo', requireAdmin(deps), (c) => {
      const days = Number(c.req.query('days') ?? 30);
      return c.json(analyticsService.queries.geoPoints(days), 200);
    })
    // 지도가 비는 원인 진단 — GeoIP DB 로드 상태 + 위치 조회 실패 IP 표본
    .get('/geo/status', requireAdmin(deps), async (c) => {
      const days = Number(c.req.query('days') ?? 30);
      const dbStatus = await probeGeoip(deps.config.geoipDbPath);
      const diag = analyticsService.queries.geoDiagnostics(days);
      const ungeolocated = analyticsService.queries.ungeolocatedIps(days, 8);
      return c.json({ dbStatus, dbPath: deps.config.geoipDbPath, ...diag, ungeolocated }, 200);
    })
    .get('/users/visits', requireAdmin(deps), (c) => {
      return c.json(analyticsService.queries.userVisitCounts(), 200);
    })
    .get('/vitals', requireAdmin(deps), (c) => {
      const metric = c.req.query('metric') ?? 'LCP';
      const days = Number(c.req.query('days') ?? 30);
      return c.json(analyticsService.queries.vitalsTrend(metric, days), 200);
    });
}
