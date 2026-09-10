/**
 * 세션 관리 — Redis(KV)에 토큰 → userId 매핑을 저장한다.
 *
 * 토큰은 256비트 난수를 base64url로 인코딩한 값이며,
 * 조회할 때마다 만료 시간이 연장되는 슬라이딩 방식이다.
 * (활성 사용자는 로그인이 풀리지 않고, 방치된 세션은 자동 소멸)
 */
import { revokeWatchSessions } from '../watch/session';
import type { AppDeps } from '../../deps';

/** KV 키 접두사 */
const PREFIX = 'sess:';

/** 암호학적으로 안전한 세션 토큰 생성 */
function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

/** 새 세션을 만들고 토큰을 반환한다. */
export async function createSession(deps: AppDeps, userId: number): Promise<string> {
  const token = generateToken();
  await deps.kv.set(PREFIX + token, String(userId), deps.config.sessionTtlSeconds);
  return token;
}

/** 토큰으로 userId를 조회하고 만료를 연장한다. 무효 토큰이면 null. */
export async function getSessionUserId(deps: AppDeps, token: string): Promise<number | null> {
  // 슬라이딩 만료 — 사용 중인 세션은 계속 살아 있게 한다. 조회와 연장을 한 번의
  // GETEX로 처리해 인증 요청마다의 Redis 왕복을 2회에서 1회로 줄인다.
  const value = await deps.kv.getAndRefresh(PREFIX + token, deps.config.sessionTtlSeconds);
  return value === null ? null : Number(value);
}

/** 세션 파기 (로그아웃) */
export async function destroySession(deps: AppDeps, token: string): Promise<void> {
  await deps.kv.del(PREFIX + token);
}

/** 계정에 연결된 모든 기기의 세션을 파기한다. */
export async function destroyAllUserSessions(deps: AppDeps, userId: number): Promise<number> {
  revokeWatchSessions(deps, userId);
  return deps.kv.deleteByValue(PREFIX, String(userId));
}

/** 세션 쿠키 이름 — 클라이언트/미들웨어가 공유 */
export const SESSION_COOKIE = 'lc_sess';
