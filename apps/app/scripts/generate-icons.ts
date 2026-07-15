/**
 * 브랜드 아이콘/스플래시 생성기 — B&W 모노 버블 (DESIGN.md 모노크롬 시스템)
 *
 * 글리프: 꼬리 달린 말풍선 + 펀치아웃(투명) 타이핑 도트 3개.
 * 하나의 글리프에서 iOS 라이트/다크/틴트, 스플래시(라이트/다크), 안드로이드 변형,
 * web PWA 아이콘, dashboard 파비콘까지 모두 만든다 (apps/lite는 제외).
 *
 * 실행:
 *   cd apps/app && bun scripts/generate-icons.ts
 */
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT_APP = path.resolve(import.meta.dir, '../assets/images');
const OUT_WEB = path.resolve(import.meta.dir, '../../web/public');
const OUT_DASH = path.resolve(import.meta.dir, '../../dashboard/public');

/* B&W 팔레트 — 잉크 블랙(#1d1d1f)은 DESIGN.md의 텍스트/브랜드 블랙 */
const INK = '#1d1d1f';
const WHITE = '#ffffff';

/**
 * 말풍선 마스크 (1024 좌표계, 중앙 배치)
 * scale/offset으로 안드로이드 세이프존 등에 맞춘다.
 */
function bubbleMask(scale = 1): string {
  const s = (n: number) => 512 + (n - 512) * scale;
  return `
    <mask id="bubble">
      <!-- 말풍선 본체 + 꼬리 -->
      <path fill="white" d="
        M ${s(232)} ${s(408)}
        C ${s(232)} ${s(333)}, ${s(293)} ${s(272)}, ${s(368)} ${s(272)}
        L ${s(656)} ${s(272)}
        C ${s(731)} ${s(272)}, ${s(792)} ${s(333)}, ${s(792)} ${s(408)}
        L ${s(792)} ${s(536)}
        C ${s(792)} ${s(611)}, ${s(731)} ${s(672)}, ${s(656)} ${s(672)}
        L ${s(430)} ${s(672)}
        C ${s(392)} ${s(742)}, ${s(330)} ${s(786)}, ${s(246)} ${s(806)}
        C ${s(298)} ${s(762)}, ${s(324)} ${s(716)}, ${s(330)} ${s(668)}
        C ${s(273)} ${s(654)}, ${s(232)} ${s(600)}, ${s(232)} ${s(536)}
        Z"/>
      <!-- 타이핑 도트 3개 — 펀치아웃 -->
      <circle cx="${s(402)}" cy="${s(472)}" r="${42 * scale}" fill="black"/>
      <circle cx="${s(512)}" cy="${s(472)}" r="${42 * scale}" fill="black"/>
      <circle cx="${s(622)}" cy="${s(472)}" r="${42 * scale}" fill="black"/>
    </mask>`;
}

/** 단색 글리프 — 마스크를 씌운 풀블리드 rect (도트는 배경이 비쳐 보인다) */
function glyph(fill: string, scale = 1): string {
  return `${bubbleMask(scale)}
    <rect width="1024" height="1024" fill="${fill}" mask="url(#bubble)"/>`;
}

/** 풀블리드 단색 배경 */
const solid = (fill: string) => `<rect width="1024" height="1024" fill="${fill}"/>`;

/** 라운드 사각 배경 — 작은 파비콘이 다크 탭바에서도 보이도록 흰 칩을 깐다 */
const chip = (fill: string) => `<rect width="1024" height="1024" rx="160" fill="${fill}"/>`;

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${body}</svg>`;

async function render(outDir: string, name: string, body: string, size = 1024): Promise<void> {
  await sharp(Buffer.from(svg(body))).resize(size, size).png().toFile(path.join(outDir, name));
  console.log(`✓ ${path.relative(path.resolve(import.meta.dir, '../..'), path.join(outDir, name))} (${size}px)`);
}

await mkdir(OUT_APP, { recursive: true });
await mkdir(OUT_WEB, { recursive: true });
await mkdir(OUT_DASH, { recursive: true });

// ── apps/app (Expo) ──────────────────────────────────────────
// iOS 라이트 — 흰 배경 + 잉크 글리프
await render(OUT_APP, 'icon.png', solid(WHITE) + glyph(INK, 1.1));
// iOS 다크 — 투명 배경 + 흰 글리프 (시스템이 어두운 배경 제공)
await render(OUT_APP, 'icon-dark.png', glyph(WHITE, 1.1));
// iOS 틴트 — 그레이스케일 글리프 (시스템이 색을 입힘)
await render(OUT_APP, 'icon-tinted.png', glyph(WHITE, 1.1));
// 스플래시 — 단색이라 라이트/다크 겸용이 불가해 두 장을 만든다
await render(OUT_APP, 'splash-icon.png', glyph(INK));
await render(OUT_APP, 'splash-icon-dark.png', glyph(WHITE));
// 안드로이드 어댑티브 — 포그라운드(세이프존 66%), 배경(흰 단색), 모노크롬
await render(OUT_APP, 'android-icon-foreground.png', glyph(INK, 0.58));
await render(OUT_APP, 'android-icon-background.png', solid(WHITE));
await render(OUT_APP, 'android-icon-monochrome.png', glyph(WHITE, 0.58));
// expo web 파비콘
await render(OUT_APP, 'favicon.png', chip(WHITE) + glyph(INK, 1.15), 48);

// ── apps/web (PWA) ───────────────────────────────────────────
// 512는 manifest에서 maskable로도 선언 — 글리프를 0.8로 줄여 세이프존을 지킨다
await render(OUT_WEB, 'icon-192.png', solid(WHITE) + glyph(INK, 0.8), 192);
await render(OUT_WEB, 'icon-512.png', solid(WHITE) + glyph(INK, 0.8), 512);

// ── apps/dashboard ───────────────────────────────────────────
// SVG 파비콘 — 브라우저 탭 테마를 따라 라이트=잉크/다크=화이트로 스스로 전환한다
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <style>.g{fill:${INK}}@media (prefers-color-scheme:dark){.g{fill:${WHITE}}}</style>
  ${bubbleMask(1.15)}
  <rect class="g" width="1024" height="1024" mask="url(#bubble)"/>
</svg>
`;
await writeFile(path.join(OUT_DASH, 'favicon.svg'), faviconSvg);
console.log('✓ dashboard/public/favicon.svg');
// 구형 브라우저 폴백 — 흰 칩 + 잉크 글리프
await render(OUT_DASH, 'favicon-32.png', chip(WHITE) + glyph(INK, 1.15), 32);

console.log('done');
