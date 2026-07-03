/**
 * 테스트 공용 헬퍼
 */
import type { ServerFrame } from '@litechat/types';
import type { WSContext } from 'hono/ws';
import type { AppType } from '../app';
import type { AppDeps } from '../deps';

/** 가입 후 { user, cookie }를 반환한다. 통합 테스트에서 사용자 준비용. */
export async function signup(app: AppType, username: string, nickname = username) {
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123', nickname }),
  });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status}`);
  const { user } = (await res.json()) as { user: { id: number; username: string } };
  const cookie = (res.headers.get('set-cookie') ?? '').match(/lc_sess=[^;]+/)?.[0] ?? '';
  return { user, cookie };
}

/** JSON 요청 헬퍼 — 쿠키와 본문을 붙여 app.request를 호출한다. */
export function jsonRequest(
  app: AppType,
  path: string,
  options: { method?: string; cookie?: string; body?: unknown } = {},
) {
  return app.request(path, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
}

/**
 * 가짜 WebSocket 연결 — 허브에 등록해 서버가 보내는 프레임을 수집한다.
 * WsHub는 send만 사용하므로 최소 구현으로 충분하다.
 */
export function fakeSocket(deps: AppDeps, userId: number) {
  const frames: ServerFrame[] = [];
  const ws = {
    send: (data: string) => frames.push(JSON.parse(data) as ServerFrame),
    close: () => {},
    readyState: 1,
  } as unknown as WSContext;
  deps.hub.add(userId, ws);
  return { frames, ws };
}
