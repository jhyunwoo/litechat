/**
 * litechat brand asset generator.
 *
 * One canonical vector (`brand/litechat-symbol.svg`) produces the Expo, web,
 * dashboard, social, and store icon families. `apps/lite` is intentionally not
 * read from or written to by this script.
 *
 * Run from the repository root with `bun run brand:generate`.
 */
import sharp from 'sharp';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const REPO = path.resolve(import.meta.dir, '../../..');
const SOURCE = path.join(REPO, 'brand/litechat-symbol.svg');
const PALETTE_SOURCE = path.join(REPO, 'brand/palette.json');
const STORE_FONT = path.join(REPO, 'store-assets/source/NotoSansKR-VF.otf');
const OUT_APP = path.join(REPO, 'apps/app/assets/images');
const OUT_WEB = path.join(REPO, 'apps/web/public');
const OUT_DASH = path.join(REPO, 'apps/dashboard/public');
const OUT_STORE_SOURCE = path.join(REPO, 'store-assets/source');
const OUT_PLAY = path.join(REPO, 'store-assets/play-store/ko');

type Palette = {
  primary: string;
  primaryFocus: string;
  primaryOnDark: string;
  ink: string;
  body: string;
  bodyOnDark: string;
  bodyMuted: string;
  inkMuted80: string;
  inkMuted48: string;
  dividerSoft: string;
  hairline: string;
  canvas: string;
  canvasParchment: string;
  surfacePearl: string;
  surfaceTile1: string;
  surfaceTile2: string;
  surfaceTile3: string;
  surfaceBlack: string;
  surfaceChipTranslucent: string;
  onPrimary: string;
  onDark: string;
};

const palette = JSON.parse(await readFile(PALETTE_SOURCE, 'utf8')) as Palette;
const canonicalSvg = await readFile(SOURCE, 'utf8');
const canonicalPathMatch = canonicalSvg.match(/<path\b[^>]*\/>/);
if (!canonicalPathMatch) throw new Error(`Canonical symbol path missing: ${SOURCE}`);
const canonicalPath = canonicalPathMatch[0];

const squareSvg = (body: string, size = 1024) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">${body}</svg>`;

const solid = (fill: string) => `<rect width="1024" height="1024" fill="${fill}"/>`;

function symbol(fill: string, scale = 1): string {
  const pathElement = canonicalPath.replace('currentColor', fill);
  if (scale === 1) return pathElement;
  return `<g transform="translate(512 512) scale(${scale}) translate(-512 -512)">${pathElement}</g>`;
}

function iconSurface(background: string, foreground: string, scale = 1): string {
  return solid(background) + symbol(foreground, scale);
}

async function render(
  outDir: string,
  name: string,
  body: string,
  size: number,
  options: { opaque?: boolean; rgba?: boolean; background?: string } = {},
): Promise<void> {
  await mkdir(outDir, { recursive: true });
  let image = sharp(Buffer.from(squareSvg(body))).resize(size, size, { fit: 'fill' });
  if (options.opaque) {
    image = image.flatten({ background: options.background ?? palette.canvas }).removeAlpha();
  } else if (options.rgba) {
    image = image.ensureAlpha(1);
  }
  await image.png({ compressionLevel: 9 }).toFile(path.join(outDir, name));
  console.log(`✓ ${path.relative(REPO, path.join(outDir, name))} (${size}×${size})`);
}

await Promise.all(
  [OUT_APP, OUT_WEB, OUT_DASH, OUT_STORE_SOURCE, OUT_PLAY].map((dir) =>
    mkdir(dir, { recursive: true }),
  ),
);

// Expo / native app ---------------------------------------------------------
await render(OUT_APP, 'icon.png', iconSurface(palette.canvas, palette.primary), 1024, {
  opaque: true,
  background: palette.canvas,
});
await render(
  OUT_APP,
  'icon-dark.png',
  iconSurface(palette.surfaceTile1, palette.primaryOnDark),
  1024,
  {
    opaque: true,
    background: palette.surfaceTile1,
  },
);
await render(OUT_APP, 'icon-tinted.png', symbol(palette.onPrimary), 1024, { rgba: true });
await render(OUT_APP, 'splash-icon.png', symbol(palette.primary, 0.82), 1024, { rgba: true });
await render(OUT_APP, 'splash-icon-dark.png', symbol(palette.primaryOnDark, 0.82), 1024, {
  rgba: true,
});
await render(OUT_APP, 'brand-symbol-on-dark.png', symbol(palette.primaryOnDark), 512, {
  rgba: true,
});
await render(OUT_APP, 'android-icon-foreground.png', symbol(palette.primary, 0.72), 1024, {
  rgba: true,
});
await render(OUT_APP, 'android-icon-background.png', solid(palette.canvas), 1024, {
  opaque: true,
  background: palette.canvas,
});
await render(OUT_APP, 'android-icon-monochrome.png', symbol(palette.onPrimary, 0.72), 1024, {
  rgba: true,
});
await render(OUT_APP, 'notification-icon.png', symbol(palette.onPrimary, 0.58), 1024, {
  rgba: true,
});
await render(OUT_APP, 'favicon.png', iconSurface(palette.canvas, palette.primary, 1.1), 48, {
  opaque: true,
  background: palette.canvas,
});

// Web / PWA ----------------------------------------------------------------
await copyFile(SOURCE, path.join(OUT_WEB, 'brand-symbol.svg'));
await render(OUT_WEB, 'icon-192.png', iconSurface(palette.canvas, palette.primary), 192, {
  opaque: true,
  background: palette.canvas,
});
await render(OUT_WEB, 'icon-512.png', iconSurface(palette.canvas, palette.primary), 512, {
  opaque: true,
  background: palette.canvas,
});
await render(
  OUT_WEB,
  'icon-maskable-512.png',
  iconSurface(palette.primary, palette.onPrimary, 0.72),
  512,
  {
    opaque: true,
    background: palette.primary,
  },
);
await render(OUT_WEB, 'apple-touch-icon.png', iconSurface(palette.canvas, palette.primary), 180, {
  opaque: true,
  background: palette.canvas,
});
await render(OUT_WEB, 'favicon-32.png', iconSurface(palette.canvas, palette.primary, 1.1), 32, {
  opaque: true,
  background: palette.canvas,
});
await render(OUT_WEB, 'notification-badge.png', symbol(palette.onPrimary, 0.68), 96, {
  rgba: true,
});

const webFavicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" rx="192" fill="${palette.canvas}"/>
  ${symbol(palette.primary, 1.08)}
</svg>\n`;
await writeFile(path.join(OUT_WEB, 'favicon.svg'), webFavicon);

const ogBody = `<rect width="1200" height="630" fill="${palette.canvas}"/>
  <path d="M0 515C220 430 310 620 555 545s356-18 645-120v205H0Z" fill="${palette.canvasParchment}"/>
  <g transform="translate(86 129) scale(.36)">${canonicalPath.replace('currentColor', palette.primary)}</g>`;
const [ogWordmark, ogTagline] = await Promise.all([
  sharp({
    text: {
      text: `<span foreground="${palette.ink}" font_weight="700" font_size="96256">litechat</span>`,
      font: 'Noto Sans KR',
      fontfile: STORE_FONT,
      width: 560,
      height: 120,
      rgba: true,
    },
  })
    .png()
    .toBuffer(),
  sharp({
    text: {
      text: `<span foreground="${palette.ink}" font_weight="400" font_size="36864">가볍게 이어지는 우리 대화</span>`,
      font: 'Noto Sans KR',
      fontfile: STORE_FONT,
      width: 620,
      height: 64,
      rgba: true,
    },
  })
    .png()
    .toBuffer(),
]);
await sharp(
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">${ogBody}</svg>`,
  ),
)
  .composite([
    { input: ogWordmark, left: 455, top: 202 },
    { input: ogTagline, left: 459, top: 326 },
  ])
  .flatten({ background: palette.canvas })
  .removeAlpha()
  .png({ compressionLevel: 9 })
  .toFile(path.join(OUT_WEB, 'og-image.png'));
console.log('✓ apps/web/public/og-image.png (1200×630)');

// Dashboard ----------------------------------------------------------------
await copyFile(SOURCE, path.join(OUT_DASH, 'brand-symbol.svg'));
const dashboardFavicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <style>.bg{fill:${palette.canvas}}.mark{color:${palette.primary}}@media(prefers-color-scheme:dark){.bg{fill:${palette.surfaceTile1}}.mark{color:${palette.primaryOnDark}}}</style>
  <rect class="bg" width="1024" height="1024" rx="192"/>
  <g class="mark">${canonicalPath}</g>
</svg>\n`;
await writeFile(path.join(OUT_DASH, 'favicon.svg'), dashboardFavicon);
await render(
  OUT_DASH,
  'favicon-32.png',
  iconSurface(palette.surfaceTile1, palette.primaryOnDark, 1.08),
  32,
  { opaque: true, background: palette.surfaceTile1 },
);

// Store masters -------------------------------------------------------------
await render(
  OUT_STORE_SOURCE,
  'brand-master-2048.png',
  iconSurface(palette.canvas, palette.primary),
  2048,
  { opaque: true, background: palette.canvas },
);
await render(OUT_PLAY, 'icon-512.png', iconSurface(palette.canvas, palette.primary), 512, {
  rgba: true,
});

console.log('Brand generation complete. apps/lite was not touched.');
