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

  // ── 답장: bob이 alice의 첫 메시지에 답장하면 인용문이 양쪽에 보인다
  const firstMessage = bob.locator('[data-message-id]').filter({ hasText: '안녕 바비!' }).first();
  await firstMessage.hover();
  await firstMessage.getByRole('button', { name: '이 메시지에 답장' }).click();
  await expect(bob.getByText('앨리스에게 답장')).toBeVisible();
  await bob.getByPlaceholder('메시지 보내기').fill('답장이야!');
  await bob.getByPlaceholder('메시지 보내기').press('Enter');
  // 전송에 성공하면 답장 바가 스스로 사라진다
  await expect(bob.getByText('앨리스에게 답장')).toHaveCount(0);
  await expect(alice.getByRole('main').getByText('답장이야!')).toBeVisible();
  // 인용문은 보낸 쪽과 받은 쪽 모두에 보인다 (버튼 이름에 원본 미리보기가 들어간다)
  await expect(bob.getByRole('button', { name: /안녕 바비!/ }).first()).toBeVisible();
  await expect(alice.getByRole('button', { name: /안녕 바비!/ }).first()).toBeVisible();

  // ── 긴 대화의 과거 페이지네이션: 연속 스크롤에도 중복 없이 한 번씩만 표시
  const conversationUrl = new URL(alice.url());
  const conversationId = conversationUrl.pathname.split('/').at(-1)!;
  const historyResponses = await Promise.all(
    Array.from({ length: 40 }, (_, index) =>
      alice.request.post(`${BASE}/api/chat/${conversationId}/messages`, {
        data: { k: 't', x: `history-${index + 1}` },
      }),
    ),
  );
  expect(historyResponses.every((response) => response.ok())).toBe(true);

  await alice.reload();
  const messageList = alice.getByTestId('chat-messages');
  await messageList.evaluate((element) => {
    element.scrollTop = 0;
    for (let index = 0; index < 5; index++) element.dispatchEvent(new Event('scroll'));
  });
  await expect(alice.getByRole('button', { name: '최신 메시지로 이동' })).toBeVisible();
  await expect(messageList.getByText('history-1', { exact: true })).toHaveCount(1);
  for (let index = 1; index <= 40; index++) {
    await expect(messageList.getByText(`history-${index}`, { exact: true })).toHaveCount(1);
  }

  await alice.getByRole('button', { name: '최신 메시지로 이동' }).click();
  await expect(alice.getByRole('button', { name: '최신 메시지로 이동' })).toBeHidden();

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

test('답장: 원본이 로드 범위 밖이어도 인용문이 보이고 눌러서 원본으로 이동한다', async ({
  browser,
}) => {
  const aliceName = uniqueName('ra');
  const bobName = uniqueName('rb');
  const aliceContext = await browser.newContext({ baseURL: BASE });
  const bobContext = await browser.newContext({ baseURL: BASE });
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();

  await register(alice, aliceName, '레이');
  await register(bob, bobName, '루비');

  await alice.getByRole('link', { name: /친구/ }).click();
  await alice.getByPlaceholder('아이디로 검색 (Ctrl+K)').fill(bobName);
  await alice.getByRole('button', { name: '친구 추가' }).click();
  await bob.getByRole('link', { name: /친구/ }).click();
  await bob.getByRole('button', { name: '수락' }).click();
  await expect(bob.getByRole('link', { name: /레이/ })).toBeVisible();

  // 원본을 보내고 그 id를 확보한다.
  await alice.getByRole('link', { name: /루비/ }).click();
  const conversationId = new URL(alice.url()).pathname.split('/').at(-1)!;
  const created = await alice.request.post(`${BASE}/api/chat/${conversationId}/messages`, {
    data: { k: 't', x: '아주 오래된 원본' },
  });
  const originalId = ((await created.json()) as { message: { id: number } }).message.id;

  // 원본을 최근 30개 창 밖으로 밀어낸 뒤, 가장 최근 메시지로 답장을 만든다.
  for (let index = 1; index <= 40; index += 1) {
    await alice.request.post(`${BASE}/api/chat/${conversationId}/messages`, {
      data: { k: 't', x: `채우기-${index}` },
    });
  }
  const replied = await bob.request.post(`${BASE}/api/chat/${conversationId}/messages`, {
    data: { k: 't', x: '오래된 것에 답장', r: originalId },
  });
  expect(replied.status()).toBe(201);

  // 방을 열면 최근 30개만 로드된다 → 원본 말풍선은 없지만 인용문은 refs로 그려진다.
  await alice.reload();
  await expect(alice.getByRole('main').getByText('오래된 것에 답장')).toBeVisible();
  await expect(alice.locator(`[data-message-id="${originalId}"]`)).toHaveCount(0);
  const quote = alice.getByRole('button', { name: /아주 오래된 원본/ }).first();
  await expect(quote).toBeVisible();

  // 인용문을 누르면 과거를 되짚어 불러온 뒤 원본으로 스크롤한다.
  await quote.click();
  await expect(alice.locator(`[data-message-id="${originalId}"]`)).toBeInViewport({
    timeout: 20_000,
  });

  await aliceContext.close();
  await bobContext.close();
});
