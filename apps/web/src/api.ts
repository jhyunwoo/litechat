/**
 * 타입 안전 API 클라이언트 (Hono Stack)
 *
 * 서버의 AppType을 그대로 가져와 hc로 감싼다.
 * 경로/본문/응답이 전부 컴파일 타임에 검증된다.
 */
import type { AppType } from 'server/src/app';
import { hc } from 'hono/client';

/** 같은 오리진으로 요청 — 쿠키는 브라우저가 자동으로 붙인다 */
export const api = hc<AppType>('/');

/** 응답이 실패면 서버 오류 코드를 담아 던진다 */
export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

/** Response → JSON 파싱 + 오류 코드 추출 공통 처리 */
export async function unwrap<T>(res: Response): Promise<T> {
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
    FORBIDDEN: '이 작업을 수행할 수 없어요.',
    RATE_LIMITED: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.',
  };
  return messages[code] ?? '문제가 발생했어요. 잠시 후 다시 시도해 주세요.';
}
