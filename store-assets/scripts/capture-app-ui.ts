/**
 * Reproducible store capture runner.
 *
 * It exports the actual Expo app for web, starts the real API against a fresh
 * temporary database, creates fictional Korean or English demo accounts, and captures the
 * real app routes at device-native DPRs. No production data is read.
 *
 * Native-device follow-up commands are documented in store-assets/README.md.
 */
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const REPO = path.resolve(import.meta.dir, '../..');
const BASE_URL = 'http://localhost:3100';
const CAPTURES = path.join(
  REPO,
  'store-assets/captures',
  process.env.STORE_CAPTURE_LANGUAGE === 'en' ? 'en' : '',
);
import { translations } from '../../apps/app/src/lib/i18n/translations';
import demoEnglish from '../source/demo-en.json';
const language = process.env.STORE_CAPTURE_LANGUAGE ?? 'ko';
if (!['ko', 'en'].includes(language)) throw new Error('STORE_CAPTURE_LANGUAGE must be ko or en');
function localized(value: string): string {
  if (language === 'ko') return value;
  const dictionary: Record<string, string> = { ...translations, ...demoEnglish };
  if (!(value in dictionary)) throw new Error(`Missing capture translation: ${value}`);
  return dictionary[value];
}
const PASSWORD = 'screenshot-only-2026';

type DemoUser = { id: number; username: string; nickname: string; token: string };

type CaptureProfile = {
  directory: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
};

const PROFILES: CaptureProfile[] = [
  {
    directory: 'ios/iphone',
    viewport: { width: 440, height: 956 },
    deviceScaleFactor: 3,
  },
  {
    directory: 'ios/ipad',
    viewport: { width: 1032, height: 1376 },
    deviceScaleFactor: 2,
  },
  {
    directory: 'android/phone',
    viewport: { width: 360, height: 640 },
    deviceScaleFactor: 3,
  },
  {
    directory: 'android/tablet-7',
    viewport: { width: 960, height: 540 },
    deviceScaleFactor: 2,
  },
  {
    directory: 'android/tablet-10',
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1.5,
  },
];

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${url}`, init);
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${url}: ${response.status}`);
  return (await response.json()) as T;
}

const auth = (token: string, init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: {
    Authorization: `Bearer ${token}`,
    ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...init.headers,
  },
});

async function register(username: string, nickname: string): Promise<DemoUser> {
  const result = await json<{ user: Omit<DemoUser, 'token'>; token: string }>(
    '/api/auth/register',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, nickname: localized(nickname), password: PASSWORD }),
    },
  );
  return { ...result.user, token: result.token };
}

async function becomeFriends(requester: DemoUser, receiver: DemoUser): Promise<number> {
  await json(
    '/api/friends/requests',
    auth(requester.token, { method: 'POST', body: JSON.stringify({ userId: receiver.id }) }),
  );
  const requests = await json<{ incoming: { id: number; user: { id: number } }[] }>(
    '/api/friends/requests',
    auth(receiver.token),
  );
  const request = requests.incoming.find((item) => item.user.id === requester.id);
  if (!request)
    throw new Error(`Friend request missing: ${requester.username} -> ${receiver.username}`);
  await json(
    `/api/friends/requests/${request.id}/respond`,
    auth(receiver.token, { method: 'POST', body: JSON.stringify({ accept: true }) }),
  );
  const friends = await json<{ friends: { user: { id: number }; c: number }[] }>(
    '/api/friends',
    auth(requester.token),
  );
  const relation = friends.friends.find((item) => item.user.id === receiver.id);
  if (!relation)
    throw new Error(`Conversation missing: ${requester.username} / ${receiver.username}`);
  return relation.c;
}

async function send(user: DemoUser, conversationId: number, kind: 't' | 'e' | 'i', body: string) {
  await json(
    `/api/chat/${conversationId}/messages`,
    auth(user.token, {
      method: 'POST',
      body: JSON.stringify({ k: kind, x: kind === 't' ? localized(body) : body }),
    }),
  );
}

async function uploadPhoto(user: DemoUser): Promise<string> {
  const svg = await readFile(path.join(REPO, 'store-assets/source/demo-photo.svg'));
  const png = await sharp(svg).png().toBuffer();
  const form = new FormData();
  form.set('file', new File([png], 'weekend-walk.png', { type: 'image/png' }));
  const result = await json<{ image: { id: string } }>(
    '/api/images',
    auth(user.token, { method: 'POST', body: form }),
  );
  return result.image.id;
}

async function seedDemo() {
  const seoyun = await register('seoyun_demo', '서윤');
  const minjun = await register('minjun_walk', '민준');
  const jiwoo = await register('jiwoo_daily', '지우');
  const harin = await register('harin_note', '하린');
  const doyoon = await register('doyoon_picnic', '도윤');
  const yuna = await register('yuna_archive', '유나');

  const minjunChat = await becomeFriends(seoyun, minjun);
  const jiwooChat = await becomeFriends(seoyun, jiwoo);
  const harinChat = await becomeFriends(seoyun, harin);

  await send(minjun, minjunChat, 't', '오늘 저녁 산책 어때?');
  await send(seoyun, minjunChat, 't', '좋아! 7시에 공원 입구에서 만나자');
  await send(minjun, minjunChat, 't', '천천히 걸으면서 이야기하자');

  await send(seoyun, jiwooChat, 't', '주말에 찍은 사진 보내줄게');
  const photoId = await uploadPhoto(seoyun);
  await send(seoyun, jiwooChat, 'i', photoId);
  await send(jiwoo, jiwooChat, 't', '색감이 정말 포근하다!');

  await send(harin, harinChat, 't', '새로 생긴 카페 가봤어?');
  await send(seoyun, harinChat, 't', '아직! 다음 주에 같이 가자');
  await send(harin, harinChat, 't', '창가 자리가 편하대');

  await json(
    '/api/safety/blocks',
    auth(seoyun.token, { method: 'POST', body: JSON.stringify({ userId: yuna.id }) }),
  );

  return {
    actor: seoyun,
    discover: doyoon,
    conversations: { minjun: minjunChat, jiwoo: jiwooChat, harin: harinChat },
  };
}

async function waitForApp(page: Page, text: string) {
  const matches = page.getByText(localized(text), { exact: false });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    for (let index = 0; index < (await matches.count()); index += 1) {
      if (await matches.nth(index).isVisible()) {
        await page.waitForTimeout(450);
        return;
      }
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`No visible app text after 20 seconds: ${text}`);
}

async function applyCaptureFont(page: Page) {
  await page.addStyleTag({
    content: `@font-face{font-family:CaptureNoto;src:url('/store-font.otf') format('opentype');font-weight:100 900}@font-face{font-family:CaptureEmoji;src:url('/store-emoji.ttf') format('truetype')}*{font-family:CaptureNoto,CaptureEmoji,sans-serif!important}[class*="navigationMenuRoot"]{top:auto!important;bottom:24px!important}`,
  });
  await page.evaluate(() => document.fonts.ready);
}

async function login(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`browser console: ${message.text()}`);
  });
  page.on('requestfailed', (request) =>
    console.error(
      `browser request failed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`,
    ),
  );
  page.on('response', (response) => {
    if (response.url().includes('/api/auth/login')) {
      console.log(`login response: ${response.status()} ${response.url()}`);
    }
  });
  await page.goto(`${BASE_URL}/sign-in`, { waitUntil: 'networkidle' });
  await applyCaptureFont(page);
  await page.getByPlaceholder(localized('아이디 (영문 소문자/숫자/_)')).fill('seoyun_demo');
  const password = page.getByPlaceholder(localized('비밀번호 (8자 이상)'));
  await password.fill(PASSWORD);
  await password.press('Enter');
  try {
    await waitForApp(page, '채팅');
  } catch (error) {
    throw new Error(
      `Login did not reach the chat screen. Body: ${await page.locator('body').innerText()}`,
      {
        cause: error,
      },
    );
  }
  return page;
}

async function openRoute(page: Page, route: string, expectedText: string) {
  await page.goto(`${BASE_URL}${route}`, { waitUntil: 'networkidle' });
  await applyCaptureFont(page);
  await waitForApp(page, expectedText);
}

/** The keyboard-controller web fallback does not apply native composer insets.
 * Reserve the real composer's measured height in this browser preview only. */
async function prepareChatCapture(page: Page, lastMessage: string) {
  await waitForApp(page, lastMessage);
  const composer = page.getByTestId('chat-composer').filter({ visible: true }).first();
  const scroll = page.getByTestId('chat-messages').filter({ visible: true }).first();
  const composerBox = await composer.boundingBox();
  if (!composerBox) throw new Error('Visible chat composer missing');
  await scroll.evaluate((element, height) => {
    (element as HTMLElement).style.marginBottom = `${height + 12}px`;
  }, composerBox.height);
  await page.waitForTimeout(700);
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page.waitForTimeout(500);
  const last = scroll
    .getByText(localized(lastMessage), { exact: true })
    .filter({ visible: true })
    .last();
  const lastBox = await last.boundingBox();
  if (!lastBox || lastBox.y + lastBox.height > composerBox.y) {
    throw new Error(
      'Latest message is obscured by the composer; do not save an incomplete chat preview',
    );
  }
}

async function save(page: Page, directory: string, name: string) {
  const destination = path.join(CAPTURES, directory, `${name}.jpg`);
  await mkdir(path.dirname(destination), { recursive: true });
  await page.screenshot({ path: destination, type: 'jpeg', quality: 94, animations: 'disabled' });
  await writeFile(
    destination + '.provenance.json',
    JSON.stringify(
      {
        source: 'browser-preview',
        language,
        capture: path.relative(REPO, destination),
        capturedAt: new Date().toISOString(),
        nativeBuild: null,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`capture: ${path.relative(REPO, destination)}`);
}

async function clickVisibleText(page: Page, value: string) {
  const matches = page.getByText(localized(value), { exact: true });
  for (let index = 0; index < (await matches.count()); index += 1) {
    const candidate = matches.nth(index);
    if (await candidate.isVisible()) {
      await candidate.click();
      return;
    }
  }
  throw new Error(`No visible text target: ${value}`);
}

async function revealWideChatsTab(page: Page) {
  const conversation = page.getByText(localized('민준'), { exact: true }).first();
  // Tab labels can hydrate before the authenticated conversation query finishes.
  await conversation.waitFor({ state: 'attached', timeout: 20_000 });
  for (
    let index = 0;
    index < (await page.getByText(localized('민준'), { exact: true }).count());
    index += 1
  ) {
    if (await page.getByText(localized('민준'), { exact: true }).nth(index).isVisible()) return;
  }

  // Expo NativeTabs currently renders the root tab in the browser but can
  // hydrate it as inactive at wide widths. Native iPad/Android tabs do not
  // have this issue. Reveal only the already-rendered chats tab so the capture
  // still comes from the real responsive app component and live demo data.
  const chatsContent = conversation.locator(
    'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " tabContent ") or contains(@class, "tabContent")][1]',
  );
  if ((await chatsContent.count()) === 0) {
    throw new Error('Could not locate the rendered Expo NativeTabs chat content');
  }

  const tabContents = page.locator('[class*="tabContent"]');
  for (let index = 0; index < (await tabContents.count()); index += 1) {
    await tabContents.nth(index).evaluate((element) => {
      (element as HTMLElement).style.display = 'none';
    });
  }
  await chatsContent.evaluate((element) => {
    element.setAttribute('data-state', 'active');
    (element as HTMLElement).style.display = 'flex';
  });
  await conversation.evaluate((element) => {
    let current = element.parentElement;
    while (current?.parentElement) {
      const rect = current.getBoundingClientRect();
      const parentRect = current.parentElement.getBoundingClientRect();
      if (rect.width <= 1 && parentRect.width > 500) {
        current.style.width = '100%';
        current.style.flex = '1 1 auto';
        current.style.minWidth = '0';
        break;
      }
      current = current.parentElement;
    }
  });
  await waitForApp(page, '민준');
}

async function captureProfile(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  profile: CaptureProfile,
  seeded: Awaited<ReturnType<typeof seedDemo>>,
) {
  const context = await browser.newContext({
    viewport: profile.viewport,
    deviceScaleFactor: profile.deviceScaleFactor,
    colorScheme: 'light',
    locale: language === 'ko' ? 'ko-KR' : 'en-US',
    reducedMotion: 'reduce',
  });
  const page = await login(context);
  const isSplit = profile.viewport.width >= 768;

  if (isSplit) await revealWideChatsTab(page);

  // Login lands on the live root tab with its query cache already hydrated.
  // Keeping that page is important for the native-tabs web fallback at tablet widths.
  await save(page, profile.directory, '01-conversations');

  if (isSplit) {
    await clickVisibleText(page, '민준');
    await waitForApp(page, '천천히 걸으면서 이야기하자');
  } else {
    await openRoute(page, `/chat/${seeded.conversations.minjun}`, '민준');
  }
  await prepareChatCapture(page, '천천히 걸으면서 이야기하자');
  await save(page, profile.directory, '02-realtime-chat');

  if (isSplit) {
    await clickVisibleText(page, '지우');
    await waitForApp(page, '색감이 정말 포근하다!');
  } else {
    await openRoute(page, `/chat/${seeded.conversations.jiwoo}`, '지우');
  }
  await prepareChatCapture(page, '색감이 정말 포근하다!');
  await save(page, profile.directory, '03-photo-chat');

  await openRoute(page, '/friends', '친구');
  await page.getByPlaceholder(localized('아이디로 검색')).fill(seeded.discover.username);
  await waitForApp(page, '도윤');
  await save(page, profile.directory, '04-friend-search');

  await openRoute(page, '/profile', '푸시 알림');
  await save(page, profile.directory, '05-notifications');

  await openRoute(page, '/blocked-users', '차단한 사용자');
  await save(page, profile.directory, '06-safety');

  await openRoute(page, '/account', '계정 삭제');
  await save(page, profile.directory, '07-account-controls');

  await context.close();
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`${BASE_URL}/api/health`)).ok) return;
    } catch {
      // Server still booting.
    }
    await Bun.sleep(100);
  }
  throw new Error('Capture server did not become healthy');
}

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? chromium.executablePath();
try {
  await access(executablePath);
} catch {
  throw new Error(
    'Chromium is missing. Install Playwright Chromium or set PLAYWRIGHT_CHROMIUM_PATH to an installed executable.',
  );
}

const runtime = await mkdtemp(path.join(tmpdir(), 'litechat-store-capture-'));
const exportDir = path.join(runtime, 'app');
const dataDir = path.join(runtime, 'data');
await mkdir(dataDir, { recursive: true });

try {
  const exportProcess = Bun.spawn(
    [process.execPath, 'x', 'expo', 'export', '--platform', 'web', '--output-dir', exportDir],
    {
      cwd: path.join(REPO, 'apps/app'),
      env: {
        ...process.env,
        // Web export evaluates native plugins but never runs the Watch target.
        WATCH_API_URL: 'https://invalid.invalid',
        EXPO_PUBLIC_API_URL: BASE_URL,
        EXPO_PUBLIC_WEB_URL: BASE_URL,
      },
      stdout: 'inherit',
      stderr: 'inherit',
    },
  );
  if ((await exportProcess.exited) !== 0) throw new Error('Expo web export failed');
  await copyFile(
    path.join(REPO, 'store-assets/source/NotoSansKR-VF.otf'),
    path.join(exportDir, 'store-font.otf'),
  );
  await copyFile(
    path.join(REPO, 'store-assets/source/NotoColorEmoji.ttf'),
    path.join(exportDir, 'store-emoji.ttf'),
  );

  const server = Bun.spawn([process.execPath, 'run', path.join(REPO, 'apps/server/src/index.ts')], {
    cwd: path.join(REPO, 'apps/server'),
    env: {
      ...process.env,
      PORT: '3100',
      DB_PATH: path.join(dataDir, 'capture.db'),
      UPLOAD_DIR: path.join(dataDir, 'uploads'),
      REDIS_URL: 'memory',
      WEB_STATIC_DIR: exportDir,
      LITE_STATIC_DIR: path.join(runtime, 'unused-lite'),
      PASSWORD_MEMORY_COST: '4096',
      TRUSTED_PROXY_HOPS: '0',
    },
    stdout: 'inherit',
    stderr: 'inherit',
  });

  try {
    await waitForHealth();
    const seeded = await seedDemo();
    const browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      const requested = process.env.STORE_CAPTURE_PROFILE;
      const requestedProfiles = new Set(requested?.split(',').map((item) => item.trim()));
      const profiles = requested
        ? PROFILES.filter((profile) => requestedProfiles.has(profile.directory))
        : PROFILES;
      if (profiles.length === 0) throw new Error(`Unknown STORE_CAPTURE_PROFILE: ${requested}`);
      for (const profile of profiles) await captureProfile(browser, profile, seeded);
    } finally {
      await browser.close();
    }
  } finally {
    server.kill();
    await server.exited;
  }
} finally {
  await rm(runtime, { recursive: true, force: true });
}

console.log('Actual Expo UI capture set complete.');
