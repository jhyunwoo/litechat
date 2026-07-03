/**
 * e2e 공용 헬퍼
 */
import type { Browser, Page } from '@playwright/test';

/** 실행마다 고유한 사용자명 생성 (서버 DB는 실행 단위로 초기화되지만 안전하게) */
export function uniqueName(prefix: string): string {
  return `${prefix}${Date.now().toString(36).slice(-6)}`;
}

/** 1x1 빨간 픽셀 PNG — 이미지 업로드 테스트용 */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** 새 브라우저 컨텍스트에서 페이지를 연다 (사용자별 세션 분리) */
export async function newUserPage(browser: Browser, baseURL: string): Promise<Page> {
  const context = await browser.newContext({ baseURL });
  return context.newPage();
}
