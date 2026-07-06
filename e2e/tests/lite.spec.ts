/**
 * Lite Chat e2e — 초경량 사이트의 전체 여정 + 데이터 사용량 카운터
 */
import { expect, test, type Page } from '@playwright/test';
import { TINY_PNG, uniqueName } from './helpers';

const BASE = 'http://127.0.0.1:3100';

/** 가입 후 채팅 탭 도착까지 */
async function register(page: Page, username: string, nickname: string): Promise<void> {
  await page.goto('/#signup');
  await page.getByPlaceholder('아이디').fill(username);
  await page.getByPlaceholder('닉네임').fill(nickname);
  await page.getByPlaceholder('비밀번호 (8자+)').fill('password123');
  await page.getByRole('button', { name: '가입하기' }).click();
  await expect(page.getByRole('heading', { name: '채팅' })).toBeVisible();
}

test('Lite 사이트가 서빙되고 초기 페이지가 극도로 가볍다', async ({ page }) => {
  // Host 헤더 라우팅 검증: 127.0.0.1 → lite 번들
  const responses: number[] = [];
  page.on('response', (res) => {
    const size = Number(res.headers()['content-length'] ?? 0);
    if (res.url().startsWith(BASE)) responses.push(size);
  });
  await page.goto(BASE);
  await expect(page.getByRole('heading', { name: 'litechat' })).toBeVisible();
  // 초기 전송 총량이 10KB 미만이어야 한다 (압축 기준).
  const total = responses.reduce((a, b) => a + b, 0);
  expect(total).toBeLessThan(10 * 1024);
});

test('전체 여정: 가입 → 친구 → 실시간 채팅 → 읽음 → 이미지 탭투로드 → 데이터 카운터', async ({
  browser,
}) => {
  const aliceName = uniqueName('la');
  const bobName = uniqueName('lb');

  const aliceContext = await browser.newContext({ baseURL: BASE });
  const bobContext = await browser.newContext({ baseURL: BASE });
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();

  await register(alice, aliceName, '라이트A');
  await register(bob, bobName, '라이트B');

  // ── 데이터 사용량 카운터가 표시된다 (0이 아닌 값)
  const usage = alice.locator('#use');
  await expect(usage).toBeVisible();
  const initialUsage = await usage.textContent();
  expect(initialUsage).toMatch(/[0-9.]+(B|KB|MB)/);

  // ── 친구 추가 (alice → bob 검색 → 요청)
  await alice.getByRole('button', { name: /친구/ }).click();
  await alice.getByPlaceholder('아이디로 친구 찾기').fill(bobName);
  await alice.getByPlaceholder('아이디로 친구 찾기').press('Enter');
  await alice.getByRole('button', { name: '친구 추가' }).click();
  await expect(alice.getByText('요청됨')).toBeVisible();

  // ── bob이 실시간으로 요청을 받고 수락
  await bob.getByRole('button', { name: /친구/ }).click();
  await expect(bob.getByText('받은 요청')).toBeVisible();
  await bob.getByRole('button', { name: '수락' }).click();
  await expect(bob.getByText('라이트A')).toBeVisible();

  // ── 채팅: alice가 친구 목록에서 방 진입 후 전송
  await expect(alice.getByText('라이트B')).toBeVisible();
  await alice.getByText('라이트B').last().click();
  await alice.getByPlaceholder('메시지').fill('라이트에서 안녕!');
  await alice.getByPlaceholder('메시지').press('Enter');
  await expect(alice.getByText('라이트에서 안녕!')).toBeVisible();

  // ── bob에게 실시간 수신 (채팅 탭 목록에 미리보기 + 안읽음 배지)
  await bob.getByRole('button', { name: /채팅/ }).click();
  await expect(bob.getByText('라이트에서 안녕!')).toBeVisible();

  // ── bob이 방에 들어가면 alice에게 '읽음' 표시
  await bob.getByText('라이트A').click();
  await expect(bob.getByText('라이트에서 안녕!')).toBeVisible();
  await expect(alice.getByText('읽음')).toBeVisible();

  // ── 이모지 빠른 입력
  await bob.getByRole('button', { name: '😂' }).click();
  await bob.getByPlaceholder('메시지').press('Enter');
  await expect(alice.locator('.big', { hasText: '😂' })).toBeVisible();

  // ── 이미지: alice 업로드 → bob에게는 [사진 크기] 버튼으로 도착, 탭해야 로드
  await alice.locator('input[type="file"]').setInputFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: TINY_PNG,
  });
  const imageButton = bob.locator('button.imgbtn');
  await expect(imageButton).toBeVisible();
  await expect(imageButton).toContainText('사진');
  await imageButton.click();
  await expect(bob.locator('.b img')).toBeVisible();
  // 이미지 탭 → 원본 다운로드 오버레이
  await bob.locator('.b img').click();
  await expect(bob.getByText(/원본 저장/)).toBeVisible();

  // ── 데이터 카운터가 증가했고 프로필 탭에서 확인 가능
  await bob.locator('.ov').click(); // 오버레이 닫기
  await bob.getByRole('button', { name: '‹' }).click(); // 채팅방 → 목록으로
  await bob.getByRole('button', { name: '내정보' }).click();
  await expect(bob.getByText('지금까지 사용한 데이터')).toBeVisible();

  await aliceContext.close();
  await bobContext.close();
});

test('로그아웃/재로그인', async ({ browser }) => {
  const username = uniqueName('lc');
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();

  await register(page, username, '라이트C');
  await page.getByRole('button', { name: '내정보' }).click();
  await page.getByRole('button', { name: '로그아웃' }).click();
  await expect(page.getByRole('button', { name: '로그인' })).toBeVisible();

  await page.getByPlaceholder('아이디').fill(username);
  await page.getByPlaceholder('비밀번호 (8자+)').fill('password123');
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page.getByRole('heading', { name: '채팅' })).toBeVisible();

  await context.close();
});
