/**
 * Full Chat (web) e2e — 가입 → 친구 → 실시간 채팅 → 읽음 → 이미지 → 단축키
 */
import { expect, test, type Page } from '@playwright/test';
import { TINY_PNG, uniqueName } from './helpers';

const BASE = 'http://localhost:3100';

/** 가입 후 채팅 탭 도착까지 */
async function register(page: Page, username: string, nickname: string): Promise<void> {
  await page.goto('/register');
  await page.getByPlaceholder('아이디 (영문 소문자/숫자/_)').fill(username);
  await page.getByPlaceholder('닉네임').fill(nickname);
  await page.getByPlaceholder('비밀번호 (8자 이상)').fill('password123');
  await page.getByRole('button', { name: '가입하기' }).click();
  await expect(page.getByRole('heading', { name: '채팅' })).toBeVisible();
}

test('전체 여정: 가입 → 친구 추가/수락 → 실시간 채팅 → 읽음 표시 → 이미지', async ({ browser }) => {
  const aliceName = uniqueName('alice');
  const bobName = uniqueName('bob');

  // 두 사용자를 서로 다른 브라우저 컨텍스트(=기기)로 연다.
  const aliceContext = await browser.newContext({ baseURL: BASE });
  const bobContext = await browser.newContext({ baseURL: BASE });
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();

  await register(alice, aliceName, '앨리스');
  await register(bob, bobName, '바비');

  // ── 친구 검색 + 요청 (alice → bob)
  await alice.getByRole('link', { name: /친구/ }).click();
  await alice.getByPlaceholder('아이디로 검색 (Ctrl+K)').fill(bobName);
  await expect(alice.getByText('바비')).toBeVisible();
  await alice.getByRole('button', { name: '친구 추가' }).click();
  await expect(alice.getByText('친구 요청을 보냈어요!')).toBeVisible();

  // ── bob에게 실시간으로 요청이 도착 → 수락
  await bob.getByRole('link', { name: /친구/ }).click();
  await expect(bob.getByText('받은 요청')).toBeVisible();
  await expect(bob.getByText('앨리스')).toBeVisible();
  await bob.getByRole('button', { name: '수락' }).click();
  // 수락하면 친구 목록에 서로 나타난다.
  await expect(bob.getByRole('link', { name: /앨리스/ })).toBeVisible();
  await expect(alice.getByRole('link', { name: /바비/ })).toBeVisible();

  // ── alice가 대화방 진입 후 메시지 전송
  await alice.getByRole('link', { name: /바비/ }).click();
  await alice.getByPlaceholder('메시지 보내기').fill('안녕 바비!');
  await alice.getByPlaceholder('메시지 보내기').press('Enter');
  await expect(alice.getByRole('main').getByText('안녕 바비!')).toBeVisible();

  // ── bob 채팅 탭에 실시간 반영 (안읽음 배지 + 미리보기)
  await bob.getByRole('link', { name: /채팅/ }).click();
  const aliceConversation = bob.getByRole('link', { name: /앨리스.*안녕 바비!/ });
  await expect(aliceConversation).toBeVisible();

  // ── bob이 방에 들어가면 읽음 처리 → alice 화면에 '읽음' 표시
  await aliceConversation.click();
  await expect(bob.getByRole('main').getByText('안녕 바비!')).toBeVisible();
  await expect(alice.getByText('읽음')).toBeVisible();

  // ── bob이 답장 → alice에게 실시간 수신
  await bob.getByPlaceholder('메시지 보내기').fill('안녕 앨리스! 반가워 😊');
  await bob.getByPlaceholder('메시지 보내기').press('Enter');
  await expect(alice.getByRole('main').getByText('안녕 앨리스! 반가워 😊')).toBeVisible();

  // ── 이미지 전송: alice 업로드 → 양쪽에 썸네일 표시 → 뷰어 열기
  await alice.locator('input[type="file"]').setInputFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: TINY_PNG,
  });
  await expect(alice.locator('img[alt="사진"]')).toBeVisible();
  await expect(bob.locator('img[alt="사진"]')).toBeVisible();
  // 이미지 클릭 → 원본/저화질 다운로드 옵션 노출
  await bob.locator('img[alt="사진"]').click();
  await expect(bob.getByText(/원본 저장/)).toBeVisible();
  await bob.keyboard.press('Escape');

  await aliceContext.close();
  await bobContext.close();
});

test('로그인/로그아웃과 데스크탑 단축키', async ({ browser }) => {
  const username = uniqueName('carol');
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();

  await register(page, username, '캐롤');

  // 단축키: Alt+2 → 친구 탭, Alt+3 → 프로필, Alt+1 → 채팅
  await page.keyboard.press('Alt+2');
  await expect(page.getByRole('heading', { name: '친구', exact: true })).toBeVisible();
  await page.keyboard.press('Alt+3');
  await expect(page.getByRole('heading', { name: '프로필' })).toBeVisible();
  await page.keyboard.press('Alt+1');
  await expect(page.getByRole('heading', { name: '채팅' })).toBeVisible();

  // Ctrl+K → 친구 탭 검색창 포커스
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByPlaceholder('아이디로 검색 (Ctrl+K)')).toBeFocused();

  // 프로필에 푸시 알림 토글이 보인다.
  await page.keyboard.press('Alt+3');
  await expect(page.getByText('푸시 알림')).toBeVisible();

  // 로그아웃 → 로그인 화면 → 재로그인
  await page.getByRole('button', { name: '로그아웃' }).click();
  await expect(page.getByRole('button', { name: '로그인' })).toBeVisible();
  await page.getByPlaceholder('아이디 (영문 소문자/숫자/_)').fill(username);
  await page.getByPlaceholder('비밀번호 (8자 이상)').fill('password123');
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page.getByRole('heading', { name: '채팅' })).toBeVisible();

  await context.close();
});

test('공개 출시 페이지와 웹 계정 삭제 검증', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    // Chromium reports expected 401 form-validation responses as resource errors.
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
      consoleErrors.push(message.text());
    }
  });

  for (const [path, heading] of [
    ['/privacy', '개인정보처리방침'],
    ['/terms', '이용약관'],
    ['/support', '지원 및 문의'],
    ['/account-deletion', 'litechat 계정 삭제'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    await expect(page).toHaveURL(`${BASE}${path}`);
  }

  await page.getByLabel('아이디').fill(uniqueName('missing'));
  await page.getByLabel('현재 비밀번호').fill('password123');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '계정 영구 삭제' }).click();
  await expect(page.getByRole('alert')).toHaveText('아이디 또는 비밀번호가 올바르지 않아요.');

  const deletionUsername = uniqueName('delete');
  await register(page, deletionUsername, '삭제테스트');
  await page.goto('/account-deletion');
  await page.getByLabel('현재 비밀번호').fill('password123');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '계정 영구 삭제' }).click();
  await expect(page.getByRole('status')).toContainText('삭제가 완료되었습니다');

  await page.goto('/login');
  await page.getByPlaceholder('아이디 (영문 소문자/숫자/_)').fill(deletionUsername);
  await page.getByPlaceholder('비밀번호 (8자 이상)').fill('password123');
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page.getByRole('alert')).toHaveText('아이디 또는 비밀번호가 올바르지 않아요.');
  expect(consoleErrors).toEqual([]);
});
