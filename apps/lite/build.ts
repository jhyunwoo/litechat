/**
 * Lite Chat 빌드 스크립트
 *
 * 초저용량이 최우선 목표이므로 직접 빌드한다:
 *  1. TS 번들 + 최소화 (Bun.build)
 *  2. CSS 공백/주석 제거
 *  3. 자산 파일명에 콘텐츠 해시 부여 → 서버가 /assets/* 를 immutable 캐시로 서빙
 *  4. brotli + gzip 사전 압축 파일(.br/.gz) 생성 → 서버가 재압축 없이 그대로 전송
 *  5. robots.txt 배포
 *  6. **크기 예산 검사**: 초기 전송(html+css+js, brotli 기준)이 10KB를 넘으면 빌드 실패
 */
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dir, 'src');
const DIST = join(import.meta.dir, 'dist');
/** 초기 전송량 예산 (brotli 압축 기준 바이트) */
const BUDGET_BYTES = 10 * 1024;

rmSync(DIST, { recursive: true, force: true });
mkdirSync(join(DIST, 'assets'), { recursive: true });

/** 콘텐츠 해시 8자리 (캐시 무효화용) */
function hashOf(content: string | Uint8Array): string {
  return Bun.hash(content).toString(16).slice(0, 8);
}

/** brotli(최고 압축) + gzip 사전 압축 파일 생성. brotli 크기를 반환한다. */
async function writeCompressed(path: string, content: string | Uint8Array): Promise<number> {
  const buffer = typeof content === 'string' ? Buffer.from(content) : Buffer.from(content);
  const brotli = brotliCompressSync(buffer, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  });
  await Bun.write(path, buffer);
  await Bun.write(`${path}.br`, new Uint8Array(brotli));
  await Bun.write(`${path}.gz`, new Uint8Array(gzipSync(buffer, { level: 9 })));
  return brotli.byteLength;
}

// 1) JS 번들
const bundle = await Bun.build({
  entrypoints: [join(SRC, 'main.ts')],
  target: 'browser',
  minify: true,
});
if (!bundle.success) {
  console.error(...bundle.logs);
  process.exit(1);
}
const js = await bundle.outputs[0]!.text();
const jsName = `assets/a.${hashOf(js)}.js`;

// 2) CSS 최소화 (간단한 공백/주석 제거로 충분)
const rawCss = await Bun.file(join(SRC, 'style.css')).text();
const css = rawCss
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')
  .replace(/ ?([{}:;,>]) ?/g, '$1')
  .trim();
const cssName = `assets/a.${hashOf(css)}.css`;

// 3) HTML에 해시된 파일명 주입
const rawHtml = await Bun.file(join(SRC, 'index.html')).text();
const html = rawHtml
  .replace('{{CSS}}', `/${cssName}`)
  .replace('{{JS}}', `/${jsName}`)
  .replace(/\n\s*/g, '\n')
  .trim();

// 4) 파일 쓰기 + 사전 압축
const jsBr = await writeCompressed(join(DIST, jsName), js);
const cssBr = await writeCompressed(join(DIST, cssName), css);
const htmlBr = await writeCompressed(join(DIST, 'index.html'), html);

// 5) 크롤러 거부 정책 파일 배포
await Bun.write(join(DIST, 'robots.txt'), Bun.file(join(SRC, 'robots.txt')));

// 6) 예산 검사
const total = htmlBr + cssBr + jsBr;
console.log(`lite build — 초기 전송량 (brotli):`);
console.log(`  index.html ${htmlBr}B / ${jsName} ${jsBr}B / ${cssName} ${cssBr}B`);
console.log(`  합계 ${total}B (예산 ${BUDGET_BYTES}B)`);
if (total >= BUDGET_BYTES) {
  console.error(`❌ 크기 예산 초과! ${total}B >= ${BUDGET_BYTES}B`);
  process.exit(1);
}
console.log('✅ 예산 통과');
