/**
 * 환경 설정 — API 서버 주소
 *
 * EXPO_PUBLIC_API_URL은 빌드 시점에 번들에 인라인된다 (.env.* / eas.json env).
 */

/** API 서버 base URL (끝 슬래시 없음) */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'https://chat.moveto.kr').replace(
  /\/$/,
  '',
);

/** WebSocket 주소 — http(s) → ws(s) 치환으로 파생 */
export function wsUrl(): string {
  return `${API_URL.replace(/^http/, 'ws')}/ws`;
}

/** 이미지 URL 헬퍼 */
export function imageUrl(id: string, variant: 'thumb' | 'orig'): string {
  return `${API_URL}/img/${id}/${variant}`;
}
