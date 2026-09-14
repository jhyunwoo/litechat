import { metadataErrors, nativeCaptureErrors } from './submission-checks';
/** Fail loudly when generated brand/store assets do not match store requirements. */
import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const REPO = path.resolve(import.meta.dir, '../..');
const ROOT = path.join(REPO, 'store-assets');
const errors: string[] = [];

type Expectation = {
  file: string;
  width: number;
  height: number;
  formats?: string[];
  alpha?: boolean;
  maxBytes?: number;
  minBytes?: number;
};

const expect: Expectation[] = [];
const add = (value: Expectation) => expect.push(value);

for (const directory of ['app-store/ko/iphone-6.9', 'app-store/ko/ipad-13']) {
  for (const file of [
    '01-conversations',
    '02-realtime-chat',
    '03-photo-chat',
    '04-friend-search',
    '05-notifications',
    '06-safety',
    '07-account-controls',
  ]) {
    const tablet = directory.endsWith('ipad-13');
    add({
      file: `${directory}/${file}.jpg`,
      width: tablet ? 2064 : 1320,
      height: tablet ? 2752 : 2868,
      formats: ['jpeg', 'png'],
      alpha: false,
      minBytes: 50_000,
      maxBytes: 10_000_000,
    });
  }
}

for (const file of [
  '01-conversations',
  '02-realtime-chat',
  '03-photo-chat',
  '04-friend-search',
  '05-notifications',
  '06-safety',
  '07-account-controls',
]) {
  add({
    file: `play-store/ko/phone/${file}.jpg`,
    width: 1080,
    height: 1920,
    formats: ['jpeg', 'png'],
    alpha: false,
    minBytes: 40_000,
    maxBytes: 8_000_000,
  });
}

for (const directory of ['play-store/ko/tablet-7', 'play-store/ko/tablet-10']) {
  for (const file of [
    '01-conversations',
    '02-realtime-chat',
    '03-photo-chat',
    '04-friend-search',
    '05-notifications',
    '06-safety',
  ]) {
    add({
      file: `${directory}/${file}.jpg`,
      width: 1920,
      height: 1080,
      formats: ['jpeg', 'png'],
      alpha: false,
      minBytes: 40_000,
      maxBytes: 8_000_000,
    });
  }
}

add({
  file: 'play-store/ko/icon-512.png',
  width: 512,
  height: 512,
  formats: ['png'],
  maxBytes: 1_048_576,
});
add({
  file: 'play-store/ko/feature-graphic.png',
  width: 1024,
  height: 500,
  formats: ['png'],
  alpha: false,
  maxBytes: 15_000_000,
});
add({
  file: 'source/brand-master-2048.png',
  width: 2048,
  height: 2048,
  formats: ['png'],
  alpha: false,
});

const appAssets = path.join(REPO, 'apps/app/assets/images');
for (const [file, width, height, alpha] of [
  ['icon.png', 1024, 1024, false],
  ['icon-dark.png', 1024, 1024, false],
  ['icon-tinted.png', 1024, 1024, true],
  ['splash-icon.png', 1024, 1024, true],
  ['splash-icon-dark.png', 1024, 1024, true],
  ['brand-symbol-on-dark.png', 512, 512, true],
  ['android-icon-foreground.png', 1024, 1024, true],
  ['android-icon-background.png', 1024, 1024, false],
  ['android-icon-monochrome.png', 1024, 1024, true],
  ['notification-icon.png', 1024, 1024, true],
  ['favicon.png', 48, 48, false],
] as const) {
  expect.push({ file: path.join(appAssets, file), width, height, formats: ['png'], alpha });
}

const webAssets = path.join(REPO, 'apps/web/public');
for (const [file, width, height, format, alpha] of [
  ['brand-symbol.svg', 1024, 1024, 'svg', true],
  ['favicon.svg', 1024, 1024, 'svg', true],
  ['favicon-32.png', 32, 32, 'png', false],
  ['apple-touch-icon.png', 180, 180, 'png', false],
  ['icon-192.png', 192, 192, 'png', false],
  ['icon-512.png', 512, 512, 'png', false],
  ['icon-maskable-512.png', 512, 512, 'png', false],
  ['notification-badge.png', 96, 96, 'png', true],
  ['og-image.png', 1200, 630, 'png', false],
] as const) {
  expect.push({ file: path.join(webAssets, file), width, height, formats: [format], alpha });
}

const dashboardAssets = path.join(REPO, 'apps/dashboard/public');
for (const [file, format, alpha] of [
  ['brand-symbol.svg', 'svg', true],
  ['favicon.svg', 'svg', true],
  ['favicon-32.png', 'png', false],
] as const) {
  expect.push({
    file: path.join(dashboardAssets, file),
    width: file === 'favicon-32.png' ? 32 : 1024,
    height: file === 'favicon-32.png' ? 32 : 1024,
    formats: [format],
    alpha,
  });
}

expect.push({
  file: path.join(REPO, 'brand/litechat-symbol.svg'),
  width: 1024,
  height: 1024,
  formats: ['svg'],
  alpha: true,
});
expect.push({
  file: path.join(ROOT, 'previews/brand-contact-sheet.png'),
  width: 1800,
  height: 1180,
  formats: ['png'],
  alpha: false,
});

// Mirror the listing sets for English; canonical brand assets remain shared.
for (const item of [...expect]) {
  if (item.file.includes('/ko/')) expect.push({ ...item, file: item.file.replace('/ko/', '/en/') });
}
for (const language of ['ko', 'en']) {
  const data = JSON.parse(await readFile(path.join(ROOT, 'metadata', `${language}.json`), 'utf8'));
  errors.push(...metadataErrors(data).map((error) => `${language}: ${error}`));
}
const submission = process.argv.includes('--submission');
if (submission) {
  for (const language of ['ko', 'en']) {
    for (const name of ['01-conversations', '02-messages', '03-photo', '04-account']) {
      add({
        file: `app-store/${language}/watch/${name}.png`,
        width: 416,
        height: 496,
        formats: ['png'],
        alpha: false,
      });
    }
  }
}
for (const item of expect) {
  const absolute = path.isAbsolute(item.file) ? item.file : path.join(ROOT, item.file);
  const label = path.relative(REPO, absolute);
  if (submission && /(?:iphone-6\.9|ipad-13|phone|tablet-7|tablet-10|watch)\//.test(item.file)) {
    errors.push(
      ...(await nativeCaptureErrors(ROOT, absolute)).map((error) => `${label}: ${error}`),
    );
  }
  try {
    const [metadata, fileStat] = await Promise.all([sharp(absolute).metadata(), stat(absolute)]);
    if (metadata.width !== item.width || metadata.height !== item.height) {
      errors.push(
        `${label}: expected ${item.width}×${item.height}, got ${metadata.width}×${metadata.height}`,
      );
    }
    if (item.formats && (!metadata.format || !item.formats.includes(metadata.format))) {
      errors.push(
        `${label}: expected ${item.formats.join('/')}, got ${metadata.format ?? 'unknown'}`,
      );
    }
    if (item.alpha !== undefined && Boolean(metadata.hasAlpha) !== item.alpha) {
      errors.push(`${label}: expected hasAlpha=${item.alpha}, got ${Boolean(metadata.hasAlpha)}`);
    }
    if (item.maxBytes && fileStat.size > item.maxBytes) {
      errors.push(`${label}: ${fileStat.size} bytes exceeds ${item.maxBytes}`);
    }
    if (item.minBytes && fileStat.size < item.minBytes) {
      errors.push(`${label}: ${fileStat.size} bytes is suspiciously small`);
    }
    if (item.width !== item.height) {
      const landscape = item.width > item.height;
      if (
        (landscape && metadata.width! <= metadata.height!) ||
        (!landscape && metadata.width! >= metadata.height!)
      ) {
        errors.push(`${label}: invalid orientation`);
      }
    }
  } catch (cause) {
    errors.push(`${label}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

if (errors.length > 0) {
  console.error(`Store asset validation failed (${errors.length}):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`Store asset validation passed (${expect.length} files).`);
