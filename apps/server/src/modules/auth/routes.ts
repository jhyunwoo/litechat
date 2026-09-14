/**
 * 인증 REST 라우트: /api/auth/*
 *
 * 성공한 register/login은 httpOnly 세션 쿠키를 발급한다.
 * 프로덕션 쿠키는 __Host- 이름으로 각 사이트에 격리된다.
 */
import { validator as zValidator } from 'hono-openapi/zod';
import { deleteAccountSchema, loginSchema, registerSchema } from '@litechat/types';
import { Hono, type Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../../app';
import type { AppDeps } from '../../deps';
import { requireAuth, tokenFromRequest } from '../../middleware/auth';
import { rateLimit } from '../../middleware/rate-limit';
import { clearVisitorCookies } from '../analytics/cookies';
import {
  createSession,
  destroyAllUserSessions,
  destroySession,
  sessionCookieName,
} from './session';
import { AuthService } from './service';

/** 세션 쿠키 공통 속성 — 발급/삭제 시 동일해야 브라우저가 같은 쿠키로 취급한다 */
function cookieOptions(deps: AppDeps) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax' as const,
    secure: deps.config.isProduction,
  };
}

/**
 * 로그인 성공 시 세션을 만들고 쿠키를 설정한다.
 * 토큰을 반환해 응답 본문에도 실을 수 있게 한다 —
 * 쿠키 저장소가 없는 네이티브 앱은 이 토큰을 Keychain에 보관하고 Bearer로 보낸다.
 */
async function issueSession(c: Context<AppEnv>, deps: AppDeps, userId: number): Promise<string> {
  const token = await createSession(deps, userId);
  setCookie(c, sessionCookieName(deps), token, {
    ...cookieOptions(deps),
    maxAge: deps.config.sessionTtlSeconds,
  });
  return token;
}

export function authRoutes(deps: AppDeps) {
  const service = new AuthService(deps);

  return (
    new Hono<AppEnv>()
      // 회원가입 — 성공 시 즉시 로그인 상태가 된다.
      .post(
        '/register',
        // Keyed by the edge-provided client address. Keep this high enough for
        // households, schools and carrier NATs that legitimately share an IP.
        rateLimit(deps, { name: 'register', limit: 20, windowSeconds: 3600 }),
        zValidator('json', registerSchema),
        async (c) => {
          const user = await service.register(c.req.valid('json'));
          const token = await issueSession(c, deps, user.id);
          return c.json({ user, token }, 201);
        },
      )
      // 로그인
      .post(
        '/login',
        rateLimit(deps, { name: 'login', limit: 20, windowSeconds: 900 }),
        zValidator('json', loginSchema),
        async (c) => {
          const { username, password } = c.req.valid('json');
          const user = await service.login(username, password);
          if (!user) return c.json({ error: 'INVALID_CREDENTIALS' }, 401);
          const token = await issueSession(c, deps, user.id);
          return c.json({ user, token }, 200);
        },
      )
      // 로그아웃 — 서버 세션 파기 + 쿠키 삭제 (Bearer/쿠키 양쪽 지원)
      .post('/logout', async (c) => {
        const token = tokenFromRequest(c, deps);
        if (token) await destroySession(deps, token);
        deleteCookie(c, sessionCookieName(deps), cookieOptions(deps));
        return c.json({ ok: true }, 200);
      })
      // 내 정보 조회 — 앱 시작 시 로그인 상태 확인용
      .get('/me', requireAuth(deps), (c) => {
        const user = service.getUserById(c.var.userId);
        if (!user) return c.json({ error: 'UNAUTHORIZED' }, 401);
        return c.json({ user }, 200);
      })
      .delete('/account', requireAuth(deps), zValidator('json', deleteAccountSchema), async (c) => {
        const userId = c.var.userId;
        await service.deleteAccount(userId, c.req.valid('json').password);
        await destroyAllUserSessions(deps, userId);
        deps.hub.disconnectUser(userId);
        deleteCookie(c, sessionCookieName(deps), cookieOptions(deps));
        clearVisitorCookies(c, deps);
        return c.json({ ok: true }, 200);
      })
  );
}
