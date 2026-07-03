/**
 * API 오류 타입 — 서비스 계층에서 던지고 전역 오류 핸들러가 HTTP 응답으로 변환한다.
 *
 * code는 클라이언트가 분기할 수 있는 기계용 문자열이며,
 * 두 클라이언트 모두 이 code를 보고 사용자에게 한국어 메시지를 보여준다.
 */
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class ApiError extends Error {
  constructor(
    /** HTTP 상태 코드 */
    public status: ContentfulStatusCode,
    /** 기계 판독용 오류 코드 (예: USERNAME_TAKEN) */
    public code: string,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

/** 자주 쓰는 오류 생성 헬퍼 */
export const errors = {
  usernameTaken: () => new ApiError(409, 'USERNAME_TAKEN'),
  invalidCredentials: () => new ApiError(401, 'INVALID_CREDENTIALS'),
  unauthorized: () => new ApiError(401, 'UNAUTHORIZED'),
  notFound: () => new ApiError(404, 'NOT_FOUND'),
  forbidden: () => new ApiError(403, 'FORBIDDEN'),
  badRequest: (code = 'BAD_REQUEST') => new ApiError(400, code),
  conflict: (code = 'CONFLICT') => new ApiError(409, code),
};
