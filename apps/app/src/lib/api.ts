/**
 * 타입 안전 API 클라이언트 (Hono Stack) — apps/web/src/api.ts의 네이티브 포팅
 *
 * 차이점:
 *   - 절대 base URL (네이티브 앱은 same-origin이 없다)
 *   - 쿠키 대신 Authorization: Bearer 헤더 (Keychain에 보관된 세션 토큰)
 */
import type { AppType } from 'server/src/app';
import { hc } from 'hono/client';
import { API_URL } from './env';
import { getToken } from './session';

/** 요청마다 현재 세션 토큰을 Bearer 헤더로 붙인다 */
export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const api = hc<AppType>(API_URL, {
  headers: () => authHeaders(),
});

/** 응답이 실패면 서버 오류 코드를 담아 던진다 */
export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

/**
 * 응답의 구조적 최소 타입 — RN의 전역 Response와 hono ClientResponse가
 * 명목상 다른 타입이라 둘 다 받도록 구조 타입으로 좁힌다.
 */
interface JsonResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** Response → JSON 파싱 + 오류 코드 추출 공통 처리 */
export async function unwrap<T>(res: JsonResponse): Promise<T> {
  if (!res.ok) {
    let code = 'INTERNAL';
    try {
      code = ((await res.json()) as { error?: string }).error ?? code;
    } catch {
      /* JSON이 아닌 오류 응답은 기본 코드 유지 */
    }
    throw new ApiFailure(res.status, code);
  }
  return (await res.json()) as T;
}

/** 서버 오류 코드 → 사용자에게 보여줄 한국어 메시지 */
export function errorMessage(error: unknown): string {
  const code = error instanceof ApiFailure ? error.code : '';
  const messages: Record<string, string> = {
    USERNAME_TAKEN: '이미 사용 중인 아이디예요.',
    INVALID_CREDENTIALS: '아이디 또는 비밀번호가 올바르지 않아요.',
    UNAUTHORIZED: '로그인이 필요해요.',
    CANNOT_FRIEND_SELF: '자기 자신에게는 친구 요청을 보낼 수 없어요.',
    ALREADY_RELATED: '이미 친구이거나 요청이 진행 중이에요.',
    INVALID_IMAGE: '지원하지 않는 이미지 형식이에요.',
    INVALID_CONTENT: '메시지 내용을 확인해 주세요.',
    NOT_FOUND: '요청한 대상을 찾을 수 없어요.',
  };
  return messages[code] ?? '문제가 발생했어요. 잠시 후 다시 시도해 주세요.';
}
