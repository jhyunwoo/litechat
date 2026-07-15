/**
 * 아이콘/스플래시 미리보기 합성 — 사용자 확인용 한 장짜리 시트
 *
 * 실행: cd apps/app && bun scripts/preview-icons.ts <출력경로.png>
 */
import sharp from 'sharp';
import path from 'node:path';

const IMAGES = path.resolve(import.meta.dir, '../assets/images');
const out = process.argv[2] ?? '/tmp/icon-preview.png';

/** iOS 아이콘 라운드 마스크 (연속 곡률 근사 — 미리보기 용도) */
function roundedMask(size: number): Buffer {
  const r = Math.round(size * 0.2237);
  return Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" fill="white"/></svg>`,
  );
}

async function iosIcon(file: string, size: number, bg?: string): Promise<Buffer> {
  let base = sharp(path.join(IMAGES, file)).resize(size, size);
  if (bg) {
    // 다크 아이콘 미리보기 — 시스템 다크 배경 위에 얹는다
    base = sharp({
      create: { width: size, height: size, channels: 4, background: bg },
    }).composite([{ input: await base.png().toBuffer() }]);
  }
  return sharp(await base.png().toBuffer())
    .composite([{ input: roundedMask(size), blend: 'dest-in' }])
    .png()
    .toBuffer();
}

/** 스플래시 목업 — 배경색 캔버스 중앙에 로고 (다크는 흰 글리프 전용 파일) */
async function splashMock(bg: string, w: number, h: number, file = 'splash-icon.png'): Promise<Buffer> {
  const logo = await sharp(path.join(IMAGES, file)).resize(160, 160).png().toBuffer();
  return sharp({ create: { width: w, height: h, channels: 4, background: bg } })
    .composite([{ input: logo, top: Math.round(h / 2 - 80), left: Math.round(w / 2 - 80) }])
    .png()
    .toBuffer();
}

const SHEET_W = 1180;
const SHEET_H = 620;
const sheet = sharp({
  create: { width: SHEET_W, height: SHEET_H, channels: 4, background: '#f6f9fc' },
});

const [light, dark, tinted, splashLight, splashDark] = await Promise.all([
  iosIcon('icon.png', 220),
  iosIcon('icon-dark.png', 220, '#1c1c1e'),
  iosIcon('icon-tinted.png', 220, '#8e8e93'),
  splashMock('#ffffff', 280, 560),
  splashMock('#000000', 280, 560, 'splash-icon-dark.png'),
]);

const label = (text: string, x: number, y: number) =>
  Buffer.from(
    `<svg width="240" height="30"><text x="0" y="20" font-family="sans-serif" font-size="20" fill="#64748d">${text}</text></svg>`,
  );

await sheet
  .composite([
    { input: light, top: 80, left: 40 },
    { input: label('라이트', 0, 0), top: 320, left: 40 },
    { input: dark, top: 80, left: 300 },
    { input: label('다크', 0, 0), top: 320, left: 300 },
    { input: tinted, top: 80, left: 560 },
    { input: label('틴트', 0, 0), top: 320, left: 560 },
    { input: splashLight, top: 30, left: 830 },
    { input: splashDark, top: 30, left: 830 + 290 - 260 + 260 },
  ])
  .png()
  .toFile(out);

console.log(`preview: ${out}`);
