# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: web.spec.ts >> 전체 여정: 가입 → 친구 추가/수락 → 실시간 채팅 → 읽음 표시 → 이미지
- Location: tests/web.spec.ts:19:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('안녕 바비!')
Expected: visible
Error: strict mode violation: getByText('안녕 바비!') resolved to 2 elements:
    1) <p class="truncate text-sm text-ink-mute">안녕 바비!</p> aka getByRole('link', { name: '바 바비 오전 9:44 안녕 바비!' })
    2) <div class="rounded-2xl px-3.5 py-2 text-[15px] leading-snug whitespace-pre-wrap break-words bg-bubble-me text-white rounded-br-md">안녕 바비!</div> aka getByRole('main').getByText('안녕 바비!')

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByText('안녕 바비!')

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - navigation [ref=e4]:
    - link "채팅" [ref=e5] [cursor=pointer]:
      - /url: /
      - img [ref=e6]
      - generic [ref=e8]: 채팅
    - link "친구" [ref=e9] [cursor=pointer]:
      - /url: /friends
      - img [ref=e10]
      - generic [ref=e14]: 친구
    - link "프로필" [ref=e15] [cursor=pointer]:
      - /url: /profile
      - img [ref=e16]
      - generic [ref=e19]: 프로필
  - complementary [ref=e20]:
    - generic [ref=e21]:
      - heading "채팅" [level=1] [ref=e23]
      - list [ref=e24]:
        - listitem [ref=e25]:
          - link "바 바비 오전 9:44 안녕 바비!" [ref=e26] [cursor=pointer]:
            - /url: /chat/1
            - generic [ref=e27]: 바
            - generic [ref=e28]:
              - generic [ref=e29]:
                - generic [ref=e30]: 바비
                - generic [ref=e31]: 오전 9:44
              - paragraph [ref=e33]: 안녕 바비!
  - main [ref=e34]:
    - generic [ref=e35]:
      - generic [ref=e36]:
        - generic [ref=e37]: 바
        - generic [ref=e38]:
          - paragraph [ref=e39]: 바비
          - paragraph [ref=e40]: "@bobmse74p"
      - generic [ref=e44]:
        - generic [ref=e45]: 안녕 바비!
        - generic [ref=e46]: 오전 9:44
      - generic [ref=e48]:
        - button "사진 보내기" [ref=e50]:
          - img [ref=e51]
        - button "이모지" [ref=e54]:
          - img [ref=e55]
        - textbox "메시지 보내기" [active] [ref=e58]
        - button "전송" [disabled] [ref=e59]:
          - img [ref=e60]
```

# Test source

```ts
  1   | /**
  2   |  * Full Chat (web) e2e — 가입 → 친구 → 실시간 채팅 → 읽음 → 이미지 → 단축키
  3   |  */
  4   | import { expect, test, type Page } from '@playwright/test';
  5   | import { TINY_PNG, uniqueName } from './helpers';
  6   | 
  7   | const BASE = 'http://localhost:3100';
  8   | 
  9   | /** 가입 후 채팅 탭 도착까지 */
  10  | async function register(page: Page, username: string, nickname: string): Promise<void> {
  11  |   await page.goto('/register');
  12  |   await page.getByPlaceholder('아이디 (영문 소문자/숫자/_)').fill(username);
  13  |   await page.getByPlaceholder('닉네임').fill(nickname);
  14  |   await page.getByPlaceholder('비밀번호 (8자 이상)').fill('password123');
  15  |   await page.getByRole('button', { name: '가입하기' }).click();
  16  |   await expect(page.getByRole('heading', { name: '채팅' })).toBeVisible();
  17  | }
  18  | 
  19  | test('전체 여정: 가입 → 친구 추가/수락 → 실시간 채팅 → 읽음 표시 → 이미지', async ({ browser }) => {
  20  |   const aliceName = uniqueName('alice');
  21  |   const bobName = uniqueName('bob');
  22  | 
  23  |   // 두 사용자를 서로 다른 브라우저 컨텍스트(=기기)로 연다.
  24  |   const aliceContext = await browser.newContext({ baseURL: BASE });
  25  |   const bobContext = await browser.newContext({ baseURL: BASE });
  26  |   const alice = await aliceContext.newPage();
  27  |   const bob = await bobContext.newPage();
  28  | 
  29  |   await register(alice, aliceName, '앨리스');
  30  |   await register(bob, bobName, '바비');
  31  | 
  32  |   // ── 친구 검색 + 요청 (alice → bob)
  33  |   await alice.getByRole('link', { name: /친구/ }).click();
  34  |   await alice.getByPlaceholder('아이디로 검색 (Ctrl+K)').fill(bobName);
  35  |   await expect(alice.getByText('바비')).toBeVisible();
  36  |   await alice.getByRole('button', { name: '친구 추가' }).click();
  37  |   await expect(alice.getByText('친구 요청을 보냈어요!')).toBeVisible();
  38  | 
  39  |   // ── bob에게 실시간으로 요청이 도착 → 수락
  40  |   await bob.getByRole('link', { name: /친구/ }).click();
  41  |   await expect(bob.getByText('받은 요청')).toBeVisible();
  42  |   await expect(bob.getByText('앨리스')).toBeVisible();
  43  |   await bob.getByRole('button', { name: '수락' }).click();
  44  |   // 수락하면 친구 목록에 서로 나타난다.
  45  |   await expect(bob.getByRole('link', { name: /앨리스/ })).toBeVisible();
  46  |   await expect(alice.getByRole('link', { name: /바비/ })).toBeVisible();
  47  | 
  48  |   // ── alice가 대화방 진입 후 메시지 전송
  49  |   await alice.getByRole('link', { name: /바비/ }).click();
  50  |   await alice.getByPlaceholder('메시지 보내기').fill('안녕 바비!');
  51  |   await alice.getByPlaceholder('메시지 보내기').press('Enter');
> 52  |   await expect(alice.getByText('안녕 바비!')).toBeVisible();
      |                                           ^ Error: expect(locator).toBeVisible() failed
  53  | 
  54  |   // ── bob 채팅 탭에 실시간 반영 (안읽음 배지 + 미리보기)
  55  |   await bob.getByRole('link', { name: /채팅/ }).click();
  56  |   await expect(bob.getByText('안녕 바비!')).toBeVisible();
  57  | 
  58  |   // ── bob이 방에 들어가면 읽음 처리 → alice 화면에 '읽음' 표시
  59  |   await bob.getByText('앨리스').click();
  60  |   await expect(bob.getByText('안녕 바비!')).toBeVisible();
  61  |   await expect(alice.getByText('읽음')).toBeVisible();
  62  | 
  63  |   // ── bob이 답장 → alice에게 실시간 수신
  64  |   await bob.getByPlaceholder('메시지 보내기').fill('안녕 앨리스! 반가워 😊');
  65  |   await bob.getByPlaceholder('메시지 보내기').press('Enter');
  66  |   await expect(alice.getByText('안녕 앨리스! 반가워 😊')).toBeVisible();
  67  | 
  68  |   // ── 이미지 전송: alice 업로드 → 양쪽에 썸네일 표시 → 뷰어 열기
  69  |   await alice.locator('input[type="file"]').setInputFiles({
  70  |     name: 'photo.png',
  71  |     mimeType: 'image/png',
  72  |     buffer: TINY_PNG,
  73  |   });
  74  |   await expect(alice.locator('img[alt="사진"]')).toBeVisible();
  75  |   await expect(bob.locator('img[alt="사진"]')).toBeVisible();
  76  |   // 이미지 클릭 → 원본/저화질 다운로드 옵션 노출
  77  |   await bob.locator('img[alt="사진"]').click();
  78  |   await expect(bob.getByText(/원본 저장/)).toBeVisible();
  79  |   await bob.keyboard.press('Escape');
  80  | 
  81  |   await aliceContext.close();
  82  |   await bobContext.close();
  83  | });
  84  | 
  85  | test('로그인/로그아웃과 데스크탑 단축키', async ({ browser }) => {
  86  |   const username = uniqueName('carol');
  87  |   const context = await browser.newContext({ baseURL: BASE });
  88  |   const page = await context.newPage();
  89  | 
  90  |   await register(page, username, '캐롤');
  91  | 
  92  |   // 단축키: Alt+2 → 친구 탭, Alt+3 → 프로필, Alt+1 → 채팅
  93  |   await page.keyboard.press('Alt+2');
  94  |   await expect(page.getByRole('heading', { name: '친구', exact: true })).toBeVisible();
  95  |   await page.keyboard.press('Alt+3');
  96  |   await expect(page.getByRole('heading', { name: '프로필' })).toBeVisible();
  97  |   await page.keyboard.press('Alt+1');
  98  |   await expect(page.getByRole('heading', { name: '채팅' })).toBeVisible();
  99  | 
  100 |   // Ctrl+K → 친구 탭 검색창 포커스
  101 |   await page.keyboard.press('ControlOrMeta+k');
  102 |   await expect(page.getByPlaceholder('아이디로 검색 (Ctrl+K)')).toBeFocused();
  103 | 
  104 |   // 프로필에 푸시 알림 토글이 보인다.
  105 |   await page.keyboard.press('Alt+3');
  106 |   await expect(page.getByText('푸시 알림')).toBeVisible();
  107 | 
  108 |   // 로그아웃 → 로그인 화면 → 재로그인
  109 |   await page.getByRole('button', { name: '로그아웃' }).click();
  110 |   await expect(page.getByRole('button', { name: '로그인' })).toBeVisible();
  111 |   await page.getByPlaceholder('아이디 (영문 소문자/숫자/_)').fill(username);
  112 |   await page.getByPlaceholder('비밀번호 (8자 이상)').fill('password123');
  113 |   await page.getByRole('button', { name: '로그인' }).click();
  114 |   await expect(page.getByRole('heading', { name: '채팅' })).toBeVisible();
  115 | 
  116 |   await context.close();
  117 | });
  118 | 
```