/**
 * 인증 모듈 테스트 (TDD — 구현보다 먼저 작성됨)
 *
 * 서비스 계층(AuthService)과 라우트 계층(HTTP)을 모두 검증한다.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { createApp, type AppType } from '../../app';
import { createTestDeps, type AppDeps } from '../../deps';
import { AuthService } from './service';

/** 테스트 공용: 회원가입 요청을 보내고 응답을 반환한다 */
async function register(
  app: ReturnType<typeof createApp>,
  body: Record<string, unknown> = { username: 'alice', password: 'password123', nickname: 'Alice' },
) {
  return app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Set-Cookie 헤더에서 세션 쿠키(lc_sess=...)만 추출한다 */
function sessionCookie(res: Response): string {
  const raw = res.headers.get('set-cookie') ?? '';
  const match = raw.match(/lc_sess=[^;]+/);
  return match?.[0] ?? '';
}

let deps: AppDeps;
let app: AppType;

beforeEach(() => {
  deps = createTestDeps();
  app = createApp(deps);
});

describe('AuthService', () => {
  test('register는 비밀번호를 해시로 저장한다', async () => {
    const service = new AuthService(deps);
    const user = await service.register({
      username: 'alice',
      password: 'password123',
      nickname: 'Alice',
    });
    expect(user.username).toBe('alice');

    const row = deps.db
      .query<{ password_hash: string }, [number]>('SELECT password_hash FROM users WHERE id = ?')
      .get(user.id);
    expect(row?.password_hash).not.toContain('password123');
    expect(row?.password_hash?.startsWith('$argon2')).toBe(true);
  });

  test('중복 아이디는 register에서 거부된다', async () => {
    const service = new AuthService(deps);
    await service.register({ username: 'alice', password: 'password123', nickname: 'A' });
    expect(
      service.register({ username: 'alice', password: 'password456', nickname: 'B' }),
    ).rejects.toThrow('USERNAME_TAKEN');
  });

  test('login은 올바른 비밀번호에만 사용자 정보를 반환한다', async () => {
    const service = new AuthService(deps);
    await service.register({ username: 'alice', password: 'password123', nickname: 'Alice' });
    expect(await service.login('alice', 'password123')).toMatchObject({ username: 'alice' });
    expect(await service.login('alice', 'wrong-password')).toBeNull();
    expect(await service.login('nobody', 'password123')).toBeNull();
  });
});

describe('POST /api/auth/register', () => {
  test('가입에 성공하면 201 + 사용자 정보 + 세션 쿠키를 반환한다', async () => {
    const res = await register(app);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { user: { username: string; nickname: string } };
    expect(body.user).toMatchObject({ username: 'alice', nickname: 'Alice' });
    // 비밀번호 관련 정보는 절대 응답에 포함되면 안 된다.
    expect(JSON.stringify(body)).not.toContain('password');
    expect(sessionCookie(res)).toStartWith('lc_sess=');
  });

  test('아이디 형식이 잘못되면 400을 반환한다', async () => {
    const res = await register(app, { username: 'A!', password: 'password123', nickname: 'x' });
    expect(res.status).toBe(400);
  });

  test('중복 아이디는 409를 반환한다', async () => {
    await register(app);
    const res = await register(app);
    expect(res.status).toBe(409);
  });
});

describe('POST /api/auth/login', () => {
  test('올바른 자격증명이면 200 + 쿠키를 반환한다', async () => {
    await register(app);
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'password123' }),
    });
    expect(res.status).toBe(200);
    expect(sessionCookie(res)).toStartWith('lc_sess=');
  });

  test('잘못된 비밀번호면 401을 반환한다', async () => {
    await register(app);
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'wrong-password' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  test('세션 쿠키가 있으면 내 정보를 반환한다', async () => {
    const reg = await register(app);
    const res = await app.request('/api/auth/me', {
      headers: { cookie: sessionCookie(reg) },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: { username: string } }).user.username).toBe('alice');
  });

  test('쿠키가 없으면 401을 반환한다', async () => {
    const res = await app.request('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('무효한(로그아웃된) 세션이면 401을 반환한다', async () => {
    const reg = await register(app);
    const cookie = sessionCookie(reg);
    await app.request('/api/auth/logout', { method: 'POST', headers: { cookie } });
    const res = await app.request('/api/auth/me', { headers: { cookie } });
    expect(res.status).toBe(401);
  });
});
