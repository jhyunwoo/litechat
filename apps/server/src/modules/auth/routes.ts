/**
 * 인증 REST 라우트: /api/auth/*
 *
 * 성공한 register/login은 httpOnly 세션 쿠키를 발급한다.
 * 쿠키는 Domain 설정으로 chat/litechat 두 서브도메인에서 공유된다.
 */
import { validator as zValidator } from 'hono-openapi/zod';
import { loginSchema, registerSchema } from '@litechat/types';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../../app';
import type { AppDeps } from '../../deps';
import { requireAuth } from '../../middleware/auth';
import { createSession, destroySession, SESSION_COOKIE } from './session';
import { AuthService } from './service';

/** 세션 쿠키 공통 속성 — 발급/삭제 시 동일해야 브라우저가 같은 쿠키로 취급한다 */
function cookieOptions(deps: AppDeps) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax' as const,
    secure: deps.config.isProduction,
    ...(deps.config.cookieDomain ? { domain: deps.config.cookieDomain } : {}),
  };
}

/** 로그인 성공 시 세션을 만들고 쿠키를 설정한다 */
async function issueSession(c: Context<AppEnv>, deps: AppDeps, userId: number): Promise<void> {
  const token = await createSession(deps, userId);
  setCookie(c, SESSION_COOKIE, token, {
    ...cookieOptions(deps),
    maxAge: deps.config.sessionTtlSeconds,
  });
}

export function authRoutes(deps: AppDeps) {
  const service = new AuthService(deps);

  return (
    new Hono<AppEnv>()
      // 회원가입 — 성공 시 즉시 로그인 상태가 된다.
      .post('/register', zValidator('json', registerSchema), async (c) => {
        const user = await service.register(c.req.valid('json'));
        await issueSession(c, deps, user.id);
        return c.json({ user }, 201);
      })
      // 로그인
      .post('/login', zValidator('json', loginSchema), async (c) => {
        const { username, password } = c.req.valid('json');
        const user = await service.login(username, password);
        if (!user) return c.json({ error: 'INVALID_CREDENTIALS' }, 401);
        await issueSession(c, deps, user.id);
        return c.json({ user }, 200);
      })
      // 로그아웃 — 서버 세션 파기 + 쿠키 삭제
      .post('/logout', async (c) => {
        const token = getCookie(c, SESSION_COOKIE);
        if (token) await destroySession(deps, token);
        deleteCookie(c, SESSION_COOKIE, cookieOptions(deps));
        return c.json({ ok: true }, 200);
      })
      // 내 정보 조회 — 앱 시작 시 로그인 상태 확인용
      .get('/me', requireAuth(deps), (c) => {
        const user = service.getUserById(c.var.userId);
        if (!user) return c.json({ error: 'UNAUTHORIZED' }, 401);
        return c.json({ user }, 200);
      })
  );
}
