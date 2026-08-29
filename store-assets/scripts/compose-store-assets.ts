/** Compose deterministic App Store and Google Play marketing assets. */
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const REPO = path.resolve(import.meta.dir, '../..');
const ROOT = path.join(REPO, 'store-assets');
const FONT = path.join(ROOT, 'source/NotoSansKR-VF.otf');
const SYMBOL = path.join(REPO, 'brand/litechat-symbol.svg');
const PALETTE = JSON.parse(await readFile(path.join(REPO, 'brand/palette.json'), 'utf8')) as Record<
  string,
  string
>;
const canonicalSvg = await readFile(SYMBOL, 'utf8');
const canonicalPathMatch = canonicalSvg.match(/<path\b[^>]*\/>/);
if (!canonicalPathMatch) throw new Error(`Canonical symbol path missing: ${SYMBOL}`);
const canonicalPath = canonicalPathMatch[0];

type Layout = {
  width: number;
  height: number;
  frame: { left: number; top: number; width: number; height: number; radius: number };
  headline: { left: number; top: number; width: number; height: number; size: number };
  supporting: { left: number; top: number; width: number; height: number; size: number };
};

type Story = {
  file: string;
  headline: string;
  supporting: string;
};

const stories: Story[] = [
  {
    file: '01-conversations',
    headline: '대화가 가볍게 시작돼요',
    supporting: '친한 사람들과 이어지는 편안한 채팅',
  },
  {
    file: '02-realtime-chat',
    headline: '친구와 바로 이어지는 채팅',
    supporting: '텍스트와 이모지로 자연스럽게 이야기해요',
  },
  {
    file: '03-photo-chat',
    headline: '사진도 자연스럽게 나눠요',
    supporting: '일상의 한 장면을 대화 속에 바로 공유해요',
  },
  {
    file: '04-friend-search',
    headline: '아이디로 친구를 찾아요',
    supporting: '검색하고 요청을 보내 간단히 연결돼요',
  },
  {
    file: '05-notifications',
    headline: '알림과 화면은 내 방식대로',
    supporting: '필요한 알림과 보기 편한 테마를 선택해요',
  },
  {
    file: '06-safety',
    headline: '필요할 때 안전하게',
    supporting: '차단과 신고 기능을 가까이 두었어요',
  },
  {
    file: '07-account-controls',
    headline: '내 계정은 내가 관리해요',
    supporting: '개인정보 확인부터 계정 삭제까지 직접 제어해요',
  },
];

const layouts: Record<'applePhone' | 'appleTablet' | 'playPhone' | 'playTablet', Layout> = {
  applePhone: {
    width: 1320,
    height: 2868,
    frame: { left: 120, top: 476, width: 1080, height: 2347, radius: 72 },
    headline: { left: 110, top: 110, width: 1100, height: 130, size: 70 },
    supporting: { left: 112, top: 260, width: 1096, height: 92, size: 34 },
  },
  appleTablet: {
    width: 2064,
    height: 2752,
    frame: { left: 162, top: 390, width: 1740, height: 2320, radius: 64 },
    headline: { left: 150, top: 72, width: 1764, height: 128, size: 72 },
    supporting: { left: 154, top: 216, width: 1756, height: 80, size: 34 },
  },
  playPhone: {
    width: 1080,
    height: 1920,
    frame: { left: 120, top: 390, width: 840, height: 1493, radius: 52 },
    headline: { left: 88, top: 74, width: 904, height: 104, size: 52 },
    supporting: { left: 90, top: 204, width: 900, height: 72, size: 27 },
  },
  playTablet: {
    width: 1920,
    height: 1080,
    frame: { left: 180, top: 240, width: 1560, height: 878, radius: 42 },
    headline: { left: 160, top: 56, width: 1600, height: 90, size: 52 },
    supporting: { left: 162, top: 154, width: 1596, height: 54, size: 27 },
  },
};

function escapeMarkup(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

async function textLayer(
  value: string,
  width: number,
  height: number,
  size: number,
  color: string,
  weight: number,
) {
  return sharp({
    text: {
      text: `<span foreground="${color}" font_weight="${weight}" font_size="${size * 1024}">${escapeMarkup(value)}</span>`,
      font: 'Noto Sans KR',
      fontfile: FONT,
      width,
      height,
      align: 'left',
      rgba: true,
      spacing: 0,
    },
  })
    .png()
    .toBuffer();
}

function backgroundSvg(width: number, height: number, index: number) {
  const accent = index % 2 === 0 ? PALETTE.peach : PALETTE.lavender;
  const path = canonicalPath.replace('currentColor', PALETTE.clay);
  const scale = Math.min(width, height) / 1024;
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="${width}" height="${height}" fill="${PALETTE.cream}"/>
      <path d="M0 ${height * 0.88}C${width * 0.2} ${height * 0.8} ${width * 0.34} ${height * 0.98} ${width * 0.58} ${height * 0.91}S${width * 0.84} ${height * 0.81} ${width} ${height * 0.86}V${height}H0Z" fill="${accent}" opacity=".2"/>
      <g transform="translate(${width * 0.78} ${-height * 0.07}) scale(${scale * 0.34})" opacity=".055">${path}</g>
      <circle cx="${width * 0.08}" cy="${height * 0.72}" r="${Math.min(width, height) * 0.12}" fill="${PALETTE.clay}" opacity=".035"/>
    </svg>
  `);
}

async function roundedCapture(input: string, frame: Layout['frame']) {
  const image = await sharp(input)
    .resize(frame.width, frame.height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .jpeg({ quality: 93, chromaSubsampling: '4:4:4' })
    .toBuffer();
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}"><rect width="${frame.width}" height="${frame.height}" rx="${frame.radius}" fill="white"/></svg>`,
  );
  return sharp(image)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

async function composeScreenshot(
  input: string,
  output: string,
  story: Story,
  layout: Layout,
  index: number,
) {
  const [capture, headline, supporting] = await Promise.all([
    roundedCapture(input, layout.frame),
    textLayer(
      story.headline,
      layout.headline.width,
      layout.headline.height,
      layout.headline.size,
      PALETTE.cocoa,
      700,
    ),
    textLayer(
      story.supporting,
      layout.supporting.width,
      layout.supporting.height,
      layout.supporting.size,
      PALETTE.cocoa,
      400,
    ),
  ]);
  const frameUnderlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.frame.width + 8}" height="${layout.frame.height + 8}"><rect x="4" y="4" width="${layout.frame.width}" height="${layout.frame.height}" rx="${layout.frame.radius + 2}" fill="${PALETTE.cocoa}" opacity=".12"/></svg>`,
  );

  await mkdir(path.dirname(output), { recursive: true });
  await sharp(backgroundSvg(layout.width, layout.height, index))
    .composite([
      { input: headline, left: layout.headline.left, top: layout.headline.top },
      { input: supporting, left: layout.supporting.left, top: layout.supporting.top },
      {
        input: frameUnderlay,
        left: layout.frame.left - 4,
        top: layout.frame.top - 4,
      },
      { input: capture, left: layout.frame.left, top: layout.frame.top },
    ])
    .flatten({ background: PALETTE.cream })
    .removeAlpha()
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toFile(output);
  console.log(`compose: ${path.relative(REPO, output)} (${layout.width}×${layout.height})`);
}

async function composeSet(
  captures: string,
  destination: string,
  layout: Layout,
  selectedStories = stories,
) {
  for (const [index, story] of selectedStories.entries()) {
    await composeScreenshot(
      path.join(ROOT, 'captures', captures, `${story.file}.jpg`),
      path.join(ROOT, destination, `${story.file}.jpg`),
      story,
      layout,
      index,
    );
  }
}

await composeSet('ios/iphone', 'app-store/ko/iphone-6.9', layouts.applePhone);
await composeSet('ios/ipad', 'app-store/ko/ipad-13', layouts.appleTablet);
await composeSet('android/phone', 'play-store/ko/phone', layouts.playPhone);
await composeSet(
  'android/tablet-7',
  'play-store/ko/tablet-7',
  layouts.playTablet,
  stories.slice(0, 6),
);
await composeSet(
  'android/tablet-10',
  'play-store/ko/tablet-10',
  layouts.playTablet,
  stories.slice(0, 6),
);

async function composeFeatureGraphic() {
  const width = 1024;
  const height = 500;
  const pathElement = canonicalPath.replace('currentColor', PALETTE.clay);
  const base = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="1024" height="500" fill="${PALETTE.cream}"/>
      <path d="M0 390C175 330 285 485 474 410s340-33 550-116v206H0Z" fill="${PALETTE.peach}" opacity=".52"/>
      <path d="M730-120C900-82 1001 57 965 200s-182 228-329 180c-113-37-169-130-132-233 39-108 104-194 226-267Z" fill="${PALETTE.lavender}" opacity=".2"/>
      <g transform="translate(618 -4) scale(.42)" opacity=".95">${pathElement}</g>
      <circle cx="822" cy="344" r="28" fill="${PALETTE.clay}" opacity=".28"/>
      <circle cx="888" cy="359" r="18" fill="${PALETTE.cocoa}" opacity=".22"/>
    </svg>
  `);
  const [wordmark, tagline] = await Promise.all([
    textLayer('litechat', 460, 100, 66, PALETTE.cocoa, 700),
    textLayer('가볍게 이어지는 우리 대화', 480, 58, 27, PALETTE.cocoa, 400),
  ]);
  const destination = path.join(ROOT, 'play-store/ko/feature-graphic.png');
  await sharp(base)
    .composite([
      { input: wordmark, left: 96, top: 151 },
      { input: tagline, left: 100, top: 262 },
    ])
    .flatten({ background: PALETTE.cream })
    .removeAlpha()
    .png({ compressionLevel: 9, palette: false })
    .toFile(destination);
  console.log(`compose: ${path.relative(REPO, destination)} (1024×500)`);
}

await composeFeatureGraphic();
console.log('Store asset composition complete.');
