/**
 * Playwright e2e 설정
 *
 * 실제 서버(빌드된 web/lite 정적 파일 포함)를 :3100에 띄우고 테스트한다.
 * - web  프로젝트: http://localhost:3100  (기본 호스트 → Full Chat)
 * - lite 프로젝트: http://127.0.0.1:3100  (LITE_HOST=127.0.0.1 → Lite Chat)
 * 같은 서버가 Host 헤더로 두 사이트를 구분하는 실제 배포 방식 그대로를 검증한다.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: false, // 하나의 서버/DB를 공유하므로 순차 실행
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : undefined,
  },
  webServer: {
    command: 'sh ./start-server.sh',
    url: 'http://localhost:3100/api/health',
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'web',
      testMatch: /web\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3100' },
    },
    {
      name: 'lite',
      testMatch: /lite\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:3100' },
    },
  ],
});
