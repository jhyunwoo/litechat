/**
 * 브랜드 아이콘/스플래시 생성기 — DESIGN.md 토큰 기반
 *
 * 글리프: 꼬리 달린 말풍선 + 펀치아웃(투명) 타이핑 도트 3개.
 * 하나의 글리프에서 iOS 라이트/다크/틴트, 스플래시, 안드로이드 변형을 모두 만든다.
 *
 * 실행 (sharp는 서버 워크스페이스 의존성):
 *   cd apps/server && bun ../app/scripts/generate-icons.ts
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve(import.meta.dir, '../assets/images');

/* DESIGN.md 색상 */
const INDIGO_SOFT = '#665efd';
const INDIGO = '#533afd';
const INDIGO_DEEP = '#4434d4';
const MAGENTA = '#f96bee';
const RUBY = '#ea2261';
const CREAM = '#f5e9d4';

/**
 * 말풍선 글리프 (1024 좌표계, 중앙 배치)
 * scale/offset으로 안드로이드 세이프존 등에 맞춘다.
 */
function glyph(fill: string, scale = 1): string {
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
    </mask>
    <rect width="1024" height="1024" fill="${fill}" mask="url(#bubble)"/>`;
}

/** 인디고 그라디언트 + 메시 글로우 배경 (브랜드 시그니처) */
const MESH_BG = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${INDIGO_SOFT}"/>
      <stop offset="0.55" stop-color="${INDIGO}"/>
      <stop offset="1" stop-color="${INDIGO_DEEP}"/>
    </linearGradient>
    <radialGradient id="glow-magenta" cx="0.85" cy="0.12" r="0.6">
      <stop offset="0" stop-color="${MAGENTA}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="${MAGENTA}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow-ruby" cx="0.12" cy="0.92" r="0.55">
      <stop offset="0" stop-color="${RUBY}" stop-opacity="0.4"/>
      <stop offset="1" stop-color="${RUBY}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow-cream" cx="0.1" cy="0.05" r="0.45">
      <stop offset="0" stop-color="${CREAM}" stop-opacity="0.3"/>
      <stop offset="1" stop-color="${CREAM}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <rect width="1024" height="1024" fill="url(#glow-cream)"/>
  <rect width="1024" height="1024" fill="url(#glow-magenta)"/>
  <rect width="1024" height="1024" fill="url(#glow-ruby)"/>`;

/** 글리프 전용 그라디언트 (스플래시/안드로이드 포그라운드용) */
const GLYPH_GRADIENT = `
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${INDIGO_SOFT}"/>
      <stop offset="1" stop-color="${INDIGO_DEEP}"/>
    </linearGradient>
  </defs>`;

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${body}</svg>`;

async function render(name: string, body: string, size = 1024): Promise<void> {
  await sharp(Buffer.from(svg(body))).resize(size, size).png().toFile(path.join(OUT, name));
  console.log(`✓ ${name} (${size}px)`);
}

await mkdir(OUT, { recursive: true });

// iOS 라이트 — 메시 배경 + 흰 글리프 (도트는 배경이 비쳐 보인다)
await render('icon.png', MESH_BG + glyph('white', 0.92));
// iOS 다크 — 투명 배경 + 흰 글리프 (시스템이 어두운 배경 제공)
await render('icon-dark.png', glyph('white', 0.92));
// iOS 틴트 — 그레이스케일 글리프 (시스템이 색을 입힘)
await render('icon-tinted.png', glyph('white', 0.92));
// 스플래시 — 투명 배경 + 인디고 그라디언트 글리프 (흰/잉크 배경 위에 얹힘)
await render('splash-icon.png', GLYPH_GRADIENT + glyph('url(#g)'));
// 안드로이드 어댑티브 — 포그라운드(세이프존 66%), 배경(메시), 모노크롬
await render('android-icon-foreground.png', glyph('white', 0.58));
await render('android-icon-background.png', MESH_BG);
await render('android-icon-monochrome.png', glyph('white', 0.58));

console.log('done');
