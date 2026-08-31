/** Build a visual QA contact sheet for every important logo behavior. */
import sharp, { type OverlayOptions } from 'sharp';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const REPO = path.resolve(import.meta.dir, '../../..');
const palette = JSON.parse(await readFile(path.join(REPO, 'brand/palette.json'), 'utf8')) as Record<
  string,
  string
>;
const IMAGES = path.join(REPO, 'apps/app/assets/images');
const out = path.resolve(
  process.argv[2] ?? path.join(REPO, 'store-assets/previews/brand-contact-sheet.png'),
);
const W = 1800;
const H = 1180;
const canvas = palette.canvas;
const ink = palette.ink;
const darkTile = palette.surfaceTile1;
const primary = palette.primary;
const sheetBackground = palette.surfacePearl;

const text = (value: string, width: number, height = 44, color = ink, size = 28) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="0" y="${Math.round(size * 1.15)}" font-family="Arial,sans-serif" font-size="${size}" font-weight="600" fill="${color}">${value}</text></svg>`,
  );

const mask = (shape: 'circle' | 'squircle', size: number) =>
  Buffer.from(
    shape === 'circle'
      ? `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/></svg>`
      : `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${Math.round(size * 0.22)}" fill="white"/></svg>`,
  );

async function tile(
  file: string,
  size: number,
  background?: string,
  shape?: 'circle' | 'squircle',
) {
  const icon = await sharp(path.join(IMAGES, file)).resize(size, size).png().toBuffer();
  const composed = await sharp({
    create: { width: size, height: size, channels: 4, background: background ?? '#ffffff00' },
  })
    .composite([{ input: icon }])
    .png()
    .toBuffer();

  if (!shape) return composed;

  return sharp(composed)
    .composite([{ input: mask(shape, size), blend: 'dest-in' }])
    .png()
    .toBuffer();
}

const [iosLight, iosDark, iosTinted, androidCircle, androidSquircle, splashLight, splashDark] =
  await Promise.all([
    tile('icon.png', 280, canvas, 'squircle'),
    tile('icon-dark.png', 280, darkTile, 'squircle'),
    tile('icon-tinted.png', 280, primary, 'squircle'),
    tile('icon.png', 280, canvas, 'circle'),
    tile('icon.png', 280, canvas, 'squircle'),
    tile('splash-icon.png', 180, canvas),
    tile('splash-icon-dark.png', 180, darkTile),
  ]);

const sheet = sharp({
  create: { width: W, height: H, channels: 4, background: sheetBackground },
});
const composites: OverlayOptions[] = [
  { input: text('litechat brand QA', 700, 56, ink, 42), left: 60, top: 44 },
  { input: iosLight, left: 60, top: 140 },
  { input: text('iOS default', 260), left: 60, top: 435 },
  { input: iosDark, left: 370, top: 140 },
  { input: text('iOS dark', 260), left: 370, top: 435 },
  { input: iosTinted, left: 680, top: 140 },
  { input: text('iOS tinted approximation', 330), left: 680, top: 435 },
  { input: androidCircle, left: 1050, top: 140 },
  { input: text('Android circle', 280), left: 1050, top: 435 },
  { input: androidSquircle, left: 1360, top: 140 },
  { input: text('Android squircle', 300), left: 1360, top: 435 },
  { input: splashLight, left: 60, top: 600 },
  { input: splashDark, left: 270, top: 600 },
  { input: text('splash light / dark', 430), left: 60, top: 795 },
];

let x = 560;
for (const size of [16, 24, 32, 64, 128]) {
  const rendered = await tile('icon.png', size, canvas, 'squircle');
  composites.push({ input: rendered, left: x, top: 655 - Math.round(size / 2) });
  composites.push({ input: text(`${size}px`, 90, 34, ink, 20), left: x, top: 760 });
  x += Math.max(120, size + 46);
}

for (const [sourceSize, displaySize] of [
  [512, 150],
  [1024, 150],
] as const) {
  const rendered = await tile('icon.png', displaySize, canvas, 'squircle');
  composites.push({ input: rendered, left: x, top: 580 });
  composites.push({
    input: text(`${sourceSize}px source`, 150, 34, ink, 20),
    left: x,
    top: 760,
  });
  x += 190;
}

for (const [index, { background, iconFile }] of [
  { background: palette.canvas, iconFile: 'splash-icon.png' },
  { background: palette.surfaceBlack, iconFile: 'splash-icon-dark.png' },
  { background: palette.canvasParchment, iconFile: 'splash-icon.png' },
  { background: palette.primary, iconFile: 'icon-tinted.png' },
  { background: palette.surfaceTile1, iconFile: 'splash-icon-dark.png' },
].entries()) {
  const swatch = await sharp({
    create: { width: 250, height: 210, channels: 4, background },
  })
    .composite([
      {
        input: await sharp(path.join(IMAGES, iconFile)).resize(130, 130).png().toBuffer(),
        left: 60,
        top: 40,
      },
    ])
    .png()
    .toBuffer();
  composites.push({ input: swatch, left: 60 + index * 335, top: 900 });
}

await sheet
  .composite(composites)
  .flatten({ background: sheetBackground })
  .removeAlpha()
  .png({ compressionLevel: 9 })
  .toFile(out);
console.log(`preview: ${out}`);
