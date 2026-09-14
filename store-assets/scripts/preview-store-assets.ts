/** Generate inspectable contact sheets and a portable bilingual asset index. */
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const root = path.resolve(import.meta.dir, '..');
await mkdir(path.join(root, 'previews'), { recursive: true });
const groups = [
  'app-store/ko/iphone-6.9',
  'app-store/en/iphone-6.9',
  'app-store/ko/ipad-13',
  'app-store/en/ipad-13',
  ...['ko', 'en'].flatMap((language) =>
    ['phone', 'tablet-7', 'tablet-10'].map((device) => `play-store/${language}/${device}`),
  ),
];
const links: string[] = [];
for (const group of groups) {
  const files = (await readdir(path.join(root, group)))
    .filter((file) => /\.jpg$/.test(file))
    .sort();
  const landscape = group.includes('tablet-');
  const columns = landscape ? 2 : 4;
  const tileWidth = landscape ? 500 : 240;
  const tileHeight = landscape ? 282 : 480;
  const tiles = await Promise.all(
    files.map(async (file, i) => ({
      input: await sharp(path.join(root, group, file))
        .resize(tileWidth, tileHeight, { fit: 'contain', background: '#eee' })
        .png()
        .toBuffer(),
      left: (i % columns) * (tileWidth + 20) + 10,
      top: Math.floor(i / columns) * (tileHeight + 20) + 10,
    })),
  );
  const name = group.replaceAll('/', '-') + '.jpg';
  await sharp({
    create: {
      width: 1040,
      height: Math.ceil(files.length / columns) * (tileHeight + 20),
      channels: 3,
      background: '#eee',
    },
  })
    .composite(tiles)
    .jpeg({ quality: 90 })
    .toFile(path.join(root, 'previews', name));
  links.push(
    `<section><h2>${group}</h2><a href="previews/${name}"><img src="previews/${name}" alt="${group} contact sheet"></a><p>${files.map((file) => `<a href="${group}/${file}">${file}</a>`).join(' · ')}</p></section>`,
  );
}
await writeFile(
  path.join(root, 'index.html'),
  `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>litechat · Store assets</title><style>body{font:16px system-ui;max-width:1100px;margin:40px auto;padding:0 24px;color:#1d1d1f}a{color:#0066cc}img{max-width:100%;height:auto}section{margin:40px 0}p{line-height:1.7}</style><h1>litechat · 스토어 자료 / Store assets</h1><p>브라우저 기반 검토용 이미지입니다. 제출 전 네이티브 캡처로 교체해야 합니다.<br>Browser previews. Replace with native captures before submission.</p><p><a href="metadata/ko.md">한국어 설명</a> · <a href="metadata/en.md">English listing</a> · <a href="watch/README.md">Apple Watch capture guide</a> · <a href="SUBMISSION.md">Submission checklist</a></p>${links.join('\n')}</html>`,
);
console.log('Store contact sheets and store-assets/index.html generated.');
