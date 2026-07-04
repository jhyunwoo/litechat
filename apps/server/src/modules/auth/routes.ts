/**
 * 인증 REST 라우트: /api/auth/*
 *
 * 성공한 register/login은 httpOnly 세션 쿠키를 발급한다.
 * 쿠키는 Domain 설정으로 chat/litechat 두 서브도메인에서 공유된다.
 */
import { validator as zValidator } from 'hono-openapi/zod';
import { loginSchema, registerSchema } from '@litechat/types';
import { Hono, type Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../../app';
import type { AppDeps } from '../../deps';
import { requireAuth, tokenFromRequest } from '../../middleware/auth';
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

/**
 * 로그인 성공 시 세션을 만들고 쿠키를 설정한다.
 * 토큰을 반환해 응답 본문에도 실을 수 있게 한다 —
 * 쿠키 저장소가 없는 네이티브 앱은 이 토큰을 Keychain에 보관하고 Bearer로 보낸다.
 */
async function issueSession(c: Context<AppEnv>, deps: AppDeps, userId: number): Promise<string> {
  const token = await createSession(deps, userId);
  setCookie(c, SESSION_COOKIE, token, {
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
      .post('/register', zValidator('json', registerSchema), async (c) => {
        const user = await service.register(c.req.valid('json'));
        const token = await issueSession(c, deps, user.id);
        return c.json({ user, token }, 201);
      })
      // 로그인
      .post('/login', zValidator('json', loginSchema), async (c) => {
        const { username, password } = c.req.valid('json');
        const user = await service.login(username, password);
        if (!user) return c.json({ error: 'INVALID_CREDENTIALS' }, 401);
        const token = await issueSession(c, deps, user.id);
        return c.json({ user, token }, 200);
      })
      // 로그아웃 — 서버 세션 파기 + 쿠키 삭제 (Bearer/쿠키 양쪽 지원)
      .post('/logout', async (c) => {
        const token = tokenFromRequest(c);
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
