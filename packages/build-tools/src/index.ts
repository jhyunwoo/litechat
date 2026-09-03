/**
 * litechat 프론트엔드 빌드 공용 Vite 플러그인
 *
 * web/dashboard가 공유한다. 한 파일로 두는 이유: vite.config.ts에서 import되는 모듈은
 * Vite 설정 로더가 node_modules 패키지로 external 처리하므로, 패키지 안에서 다시
 * 상대 경로로 나뉘면 Node가 해석하지 못한다.
 */
import { brotliCompress, brotliCompressSync, brotliDecompressSync, constants, gzip, gzipSync } from 'node:zlib';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * 압축은 비동기 API로 돌린다 — zlib의 비동기 함수는 libuv 스레드풀에서 실행되므로
 * 파일 여러 개를 동시에 압축하면 코어를 실제로 나눠 쓴다(동기 API는 메인 스레드를 막는다).
 */
const brotliAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
import type { OutputBundle, OutputChunk } from 'rollup';
import type { Plugin } from 'vite';

/* ------------------------------------------------------------------ */
/* 공통                                                                 */
/* ------------------------------------------------------------------ */

/** 압축해서 이득이 있는 텍스트 자산 확장자 */
const COMPRESSIBLE = /\.(js|mjs|css|html|json|webmanifest|svg|txt|map)$/i;

/** 이보다 작은 파일은 압축해도 전송량 이득이 헤더 오버헤드에 묻힌다 */
const MIN_BYTES = 1024;

/** 예산 계산 대상 — 실제로 초기 렌더를 막는 리소스 */
const BUDGETED = /\.(js|mjs|css|html)$/i;

/** brotli 파라미터 — 정적 자산이므로 최고 품질(11). 빌드 시간만 쓰고 전송량을 최소화한다. */
function brotliParams(byteLength: number) {
  return {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: byteLength,
    },
  };
}

export function compressBuffer(buffer: Uint8Array): { gzip: Uint8Array; brotli: Uint8Array } {
  return {
    gzip: new Uint8Array(gzipSync(buffer, { level: 9 })),
    brotli: new Uint8Array(brotliCompressSync(buffer, brotliParams(buffer.byteLength))),
  };
}

async function compressBufferAsync(
  buffer: Buffer,
): Promise<{ gzip: Uint8Array; brotli: Uint8Array }> {
  const [gz, br] = await Promise.all([
    gzipAsync(buffer, { level: 9 }),
    brotliAsync(buffer, brotliParams(buffer.byteLength)),
  ]);
  return { gzip: new Uint8Array(gz), brotli: new Uint8Array(br) };
}

/**
 * 디스크에 기록된 최종 산출물을 읽는다.
 *
 * **반드시 writeBundle 시점에 디스크에서 읽어야 한다.** generateBundle의 `chunk.code`는
 * 아직 Vite 코어 플러그인(vite:build-import-analysis)이 `__VITE_PRELOAD__` 자리표시자를
 * 실제 의존성 배열로 치환하기 **전**이다. 그 시점의 코드를 압축하면 .br/.gz만 옛 내용을
 * 담게 되어, brotli를 지원하는 브라우저에서만 `__VITE_PRELOAD__ is not defined`로
 * 앱 전체가 죽는다(압축을 안 받는 클라이언트는 멀쩡해서 알아채기 어렵다).
 */
async function readEmitted(dir: string, fileName: string): Promise<Buffer> {
  return readFile(join(dir, fileName));
}

/* ------------------------------------------------------------------ */
/* 빌드 산출물 사전 압축 (brotli + gzip)                                 */
/* ------------------------------------------------------------------ */

/**
 * 빌드 산출물 사전 압축 Vite 플러그인 (brotli + gzip)
 *
 * apps/server의 static.ts는 요청의 Accept-Encoding에 맞춰 `<file>.br` / `<file>.gz`가
 * 있으면 그대로 전송한다. 즉 압축은 배포 시점에 한 번만 하고, 요청마다의 압축 CPU는 0이 된다.
 * 프로덕션 서버가 2 OCPU뿐이라 런타임 압축(Traefik/Hono compress)보다 이 방식이 유리하다.
 * apps/lite의 build.ts가 하는 일과 동일한 규약을 web/dashboard에도 적용한다.
 *
 * - 이미 압축된 포맷(png/webp/jpg/woff2 등)은 건드리지 않는다 — 더 커지기만 한다.
 * - MIN_BYTES 미만은 건너뛴다 — 압축 결과가 원본보다 커지거나 이득이 없다.
 * - brotli는 정적 자산이므로 최고 품질(11)을 쓴다. 빌드 시간만 쓰고 전송량을 최소화한다.
 */
export function precompress(sizes?: Map<string, number>): Plugin {
  return {
    name: 'litechat-precompress',
    apply: 'build',
    async writeBundle(options, bundle) {
      const dir = options.dir;
      if (!dir) return;
      // 파일들을 동시에 압축한다 — 순차로 돌면 코어 하나만 쓰게 된다.
      const failures: string[] = [];
      await Promise.all(
        Object.keys(bundle)
          .filter((fileName) => COMPRESSIBLE.test(fileName))
          .map(async (fileName) => {
            const buffer = await readEmitted(dir, fileName);
            if (buffer.byteLength < MIN_BYTES) return;

            const { gzip: gz, brotli } = await compressBufferAsync(buffer);
            // 압축본이 원본과 같은 바이트로 복원되는지 확인한다 — 위 readEmitted 주석의
            // 사고를 두 번 겪지 않기 위한 값싼 불변식 검사다.
            if (!brotliDecompressSync(brotli).equals(buffer)) {
              failures.push(fileName);
              return;
            }
            // 크기 예산 검사가 같은 파일을 brotli-11로 다시 압축하지 않도록 결과를 넘겨준다
            // (brotli-11은 빌드에서 가장 비싼 단계라 두 번 도는 값을 치를 이유가 없다).
            sizes?.set(fileName, brotli.byteLength);
            await Promise.all([
              writeFile(join(dir, `${fileName}.br`), brotli),
              writeFile(join(dir, `${fileName}.gz`), gz),
            ]);
          }),
      );
      if (failures.length > 0) {
        this.error(`사전 압축 결과가 원본과 다릅니다: ${failures.join(', ')}`);
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* 초기 전송량 예산 검사                                                 */
/* ------------------------------------------------------------------ */

/**
 * 초기 전송량 예산 검사 Vite 플러그인
 *
 * apps/lite의 build.ts가 10 KB brotli 예산을 강제하는 것과 같은 규약을 web/dashboard에도 둔다.
 * "초기 전송량"은 브라우저가 첫 화면을 그리기 위해 반드시 받아야 하는 것들의 brotli 합이다:
 *   index.html + 진입 청크 + 진입 청크가 정적으로 import하는 청크(전이적) + 그 CSS
 * 지연 로드(동적 import) 청크는 포함하지 않는다.
 *
 * CI에서 번들이 조용히 불어나는 것을 막는 회귀 가드다. 예산을 올리는 것은 의식적인 결정이어야 한다.
 */
export interface SizeBudgetOptions {
  /** 초기 전송량(brotli) 상한 바이트 */
  initialBrotliBytes: number;
  /** 개별 청크 하나가 넘으면 안 되는 brotli 상한 (선택) */
  maxChunkBrotliBytes?: number;
  /** 라벨 — 로그 출력용 */
  label: string;
}

/** 진입 청크에서 정적 import를 따라가며 초기 로드 파일 집합을 만든다. */
function initialFiles(bundle: OutputBundle): Set<string> {
  const files = new Set<string>();
  const visit = (fileName: string) => {
    if (files.has(fileName)) return;
    const output = bundle[fileName];
    if (!output || output.type !== 'chunk') return;
    files.add(fileName);
    for (const css of output.viteMetadata?.importedCss ?? []) files.add(css);
    for (const imported of output.imports) visit(imported);
  };
  for (const [fileName, output] of Object.entries(bundle)) {
    if (output.type === 'chunk' && (output as OutputChunk).isEntry) visit(fileName);
    else if (output.type === 'asset' && fileName.endsWith('.html')) files.add(fileName);
  }
  return files;
}

export function sizeBudget(options: SizeBudgetOptions, sizes?: Map<string, number>): Plugin {
  return {
    name: 'litechat-size-budget',
    apply: 'build',
    // precompress와 마찬가지로 디스크의 최종 바이트를 재야 실제 전송량과 일치한다.
    async writeBundle(outputOptions, bundle) {
      const dir = outputOptions.dir;
      if (!dir) return;
      const initial = initialFiles(bundle);
      const rows: { file: string; brotli: number; initial: boolean }[] = [];
      let total = 0;

      for (const fileName of Object.keys(bundle)) {
        if (!BUDGETED.test(fileName)) continue;
        // precompress가 이미 잰 값이 있으면 재사용한다 (MIN_BYTES 미만이라 건너뛴 파일만 직접 잰다).
        let brotliBytes = sizes?.get(fileName);
        if (brotliBytes === undefined) {
          brotliBytes = compressBuffer(await readEmitted(dir, fileName)).brotli.byteLength;
        }
        const isInitial = initial.has(fileName);
        if (isInitial) total += brotliBytes;
        rows.push({ file: fileName, brotli: brotliBytes, initial: isInitial });
      }

      rows.sort((a, b) => b.brotli - a.brotli);
      const lines = rows
        .slice(0, 12)
        .map((r) => `    ${r.initial ? '▶' : ' '} ${String(r.brotli).padStart(7)}B  ${r.file}`);
      // eslint-disable-next-line no-console -- 빌드 리포트는 의도적으로 stdout에 남긴다
      console.log(
        `\n  ${options.label} 초기 전송량(brotli): ${total}B / 예산 ${options.initialBrotliBytes}B` +
          `  (▶ = 초기 로드)\n${lines.join('\n')}\n`,
      );

      if (total > options.initialBrotliBytes) {
        this.error(
          `${options.label} 초기 전송량 예산 초과: ${total}B > ${options.initialBrotliBytes}B. ` +
            '지연 로드로 옮기거나 의존성을 줄이세요. 예산 상향은 의식적인 결정이어야 합니다.',
        );
      }
      const chunkLimit = options.maxChunkBrotliBytes;
      if (chunkLimit !== undefined) {
        const oversized = rows.filter((r) => r.brotli > chunkLimit);
        if (oversized.length > 0) {
          this.error(
            `${options.label} 청크 크기 예산 초과 (>${chunkLimit}B brotli): ` +
              oversized.map((r) => `${r.file} ${r.brotli}B`).join(', '),
          );
        }
      }
    },
  };
}

/**
 * 사전 압축 + 예산 검사를 한 쌍으로 묶어 준다.
 *
 * 두 플러그인이 brotli 결과를 공유하므로 가장 비싼 단계(brotli 품질 11)가 빌드당 한 번만 돈다.
 * 반드시 이 순서(압축 → 검사)로 등록해야 공유가 성립한다.
 */
export function litechatBuild(options: SizeBudgetOptions): Plugin[] {
  const sizes = new Map<string, number>();
  return [precompress(sizes), sizeBudget(options, sizes)];
}
