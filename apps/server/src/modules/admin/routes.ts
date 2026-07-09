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
import { geoipRefreshEnabled, geoipRefreshInfo, refreshGeoipDb } from '../analytics/geoip-updater';
import { fetchInsights, normalizeIp } from '../analytics/insights';
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
    // 대시보드 런타임 설정 — 빌드 시점이 아니라 서버 환경변수에서 주입한다(키 교체 시 재빌드 불필요).
    .get('/config', requireAdmin(deps), (c) => {
      return c.json(
        {
          googleMapsApiKey: deps.config.googleMapsApiKey,
          googleMapsMapId: deps.config.googleMapsMapId,
        },
        200,
      );
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
    // 지도가 비는 원인 진단 — GeoIP DB 로드 상태 + 위치 조회 실패 IP 표본 + 자동 갱신 상태
    .get('/geo/status', requireAdmin(deps), async (c) => {
      const days = Number(c.req.query('days') ?? 30);
      const dbStatus = await probeGeoip(deps.config.geoipDbPath);
      const diag = analyticsService.queries.geoDiagnostics(days);
      const ungeolocated = analyticsService.queries.ungeolocatedIps(days, 8);
      return c.json(
        {
          dbStatus,
          dbPath: deps.config.geoipDbPath,
          ...diag,
          ungeolocated,
          autoRefresh: geoipRefreshEnabled(deps.config),
          lastRefresh: geoipRefreshInfo(),
        },
        200,
      );
    })
    // GeoLite2 DB 수동 갱신 — 주간 자동 갱신과 같은 경로를 즉시 실행한다
    .post('/geoip/refresh', requireAdmin(deps), async (c) => {
      const info = await refreshGeoipDb(deps.config);
      return c.json(info, info.ok ? 200 : 502);
    })
    /**
     * GeoIP2 Insights 온디맨드 조회 — 선택한 IP만 조회하고 결과를 저장한다.
     * 비싼 API라서 같은 IP는 1주 안에는 저장된 행을 그대로 쓰고(cached: true),
     * API 호출이 실패해도 오래된 캐시가 있으면 그것을 stale로 표시해 내려준다.
     */
    .post('/geoip/insights/:ip', requireAdmin(deps), async (c) => {
      const ip = normalizeIp(decodeURIComponent(c.req.param('ip')));
      if (!ip) return c.json({ error: 'INVALID_IP' }, 400);

      const cachedRow = analyticsService.queries.getInsights(ip);
      const weekAgo = Math.floor(Date.now() / 1000) - 7 * 86400;
      if (cachedRow && cachedRow.fetchedAt >= weekAgo) {
        return c.json({ cached: true, stale: false, insights: cachedRow }, 200);
      }

      const result = await fetchInsights(deps.config, ip);
      if (!result.ok) {
        if (cachedRow) return c.json({ cached: true, stale: true, insights: cachedRow }, 200);
        return c.json({ error: result.error }, result.error === 'MAXMIND_NOT_CONFIGURED' ? 400 : 502);
      }
      analyticsService.queries.upsertInsights(result.row);
      return c.json({ cached: false, stale: false, insights: result.row }, 200);
    })
    // 접속 기록 데이터 탐색기 — 개별 세션을 필터/정렬/페이지로 나열한다
    .get('/sessions', requireAdmin(deps), (c) => {
      const q = (name: string) => c.req.query(name);
      const page = Math.max(1, Number(q('page') ?? 1) || 1);
      const pageSize = Math.min(200, Math.max(1, Number(q('pageSize') ?? 50) || 50));
      const result = analyticsService.queries.listSessions({
        userId: q('userId') ? Number(q('userId')) : undefined,
        platform: q('platform') || undefined,
        ip: q('ip') || undefined,
        from: q('from') ? Number(q('from')) : undefined,
        to: q('to') ? Number(q('to')) : undefined,
        sort: q('sort') === 'last_seen_at' ? 'last_seen_at' : 'created_at',
        dir: q('dir') === 'asc' ? 'asc' : 'desc',
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      return c.json({ ...result, page, pageSize }, 200);
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
