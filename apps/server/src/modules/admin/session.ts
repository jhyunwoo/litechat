/**
 * 관리자 세션 관리 — auth/session.ts와 동일한 Redis(KV) 슬라이딩 세션 메커니즘을
 * 재사용하되, 키 프리픽스와 쿠키 이름을 완전히 분리해 채팅 세션과 절대 섞이지 않게 한다.
 */
import type { AppDeps } from '../../deps';

const PREFIX = 'admin_sess:';

/** 관리자 세션 유효 기간 (초) — 채팅 세션보다 짧게 (12시간, 관리 도구이므로) */
const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 12;

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

export async function createAdminSession(deps: AppDeps, adminId: number): Promise<string> {
  const token = generateToken();
  await deps.kv.set(PREFIX + token, String(adminId), ADMIN_SESSION_TTL_SECONDS);
  return token;
}

export async function getAdminSessionId(deps: AppDeps, token: string): Promise<number | null> {
  const value = await deps.kv.get(PREFIX + token);
  if (value === null) return null;
  await deps.kv.expire(PREFIX + token, ADMIN_SESSION_TTL_SECONDS);
  return Number(value);
}

export async function destroyAdminSession(deps: AppDeps, token: string): Promise<void> {
  await deps.kv.del(PREFIX + token);
}

/** 관리자 세션 쿠키 이름 — 채팅(lc_sess)과 다른 이름, 호스트 전용(Domain 미지정)으로 발급된다 */
export const ADMIN_SESSION_COOKIE = 'lc_admin_sess';
export { ADMIN_SESSION_TTL_SECONDS };
