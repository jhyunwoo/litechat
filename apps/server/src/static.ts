/**
 * 정적 파일 서빙 + Host 헤더 기반 프론트엔드 라우팅
 *
 * 하나의 컨테이너가 두 도메인을 모두 서빙한다:
 *   - chat.moveto.kr     → apps/web  빌드 산출물 (Full Chat)
 *   - litechat.moveto.kr → apps/lite 빌드 산출물 (Lite Chat)
 *
 * 전송량 최소화를 위한 규칙:
 *   - 빌드 시 생성된 사전 압축 파일(.br, .gz)이 있으면 그대로 전송 (재압축 비용 0)
 *   - 해시가 붙은 자산(/assets/*)은 immutable 캐시 → 재방문 시 전송량 0
 *   - SPA 라우팅: 파일이 없으면 index.html 반환
 */
import type { MiddlewareHandler } from 'hono';
import { join, extname } from 'node:path';
import type { AppDeps } from './deps';

/** 확장자별 Content-Type 매핑 (필요한 것만 최소한으로) */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

/**
 * 요청 Host에 따라 web/lite 정적 디렉터리에서 파일을 서빙하는 미들웨어를 만든다.
 * API/WS/이미지 경로 뒤에 마지막 핸들러로 등록해야 한다.
 */
export function serveFrontend(deps: AppDeps): MiddlewareHandler {
  const { config } = deps;

  return async (c) => {
    // Host 헤더에서 포트를 제거하고 lite 도메인이면 lite 번들을 선택한다.
    // 그 외(chat 도메인, localhost 등)는 기본적으로 Full Chat을 서빙한다.
    const host = (c.req.header('host') ?? '').split(':')[0] ?? '';
    const root = host === config.liteHost ? config.liteStaticDir : config.webStaticDir;

    // 경로 정규화 — 디렉터리 탈출(..) 차단
    let pathname = decodeURIComponent(new URL(c.req.url).pathname);
    if (pathname.includes('..')) return c.text('Bad Request', 400);
    if (pathname.endsWith('/')) pathname += 'index.html';

    let filePath = join(root, pathname);
    let file = Bun.file(filePath);

    // SPA fallback: 존재하지 않는 경로는 index.html로 (클라이언트 라우팅)
    if (!(await file.exists())) {
      filePath = join(root, 'index.html');
      file = Bun.file(filePath);
      if (!(await file.exists())) return c.text('Not Found', 404);
    }

    const ext = extname(filePath);
    const headers = new Headers({ 'Content-Type': MIME[ext] ?? 'application/octet-stream' });

    // 해시 파일명 자산은 1년 immutable — 재방문 시 네트워크 요청조차 없음
    if (pathname.startsWith('/assets/')) {
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      // HTML 등은 항상 재검증 (배포 즉시 반영)
      headers.set('Cache-Control', 'no-cache');
    }

    // 빌드 시 미리 압축해 둔 .br/.gz가 있으면 그쪽을 전송한다.
    const accept = c.req.header('accept-encoding') ?? '';
    for (const [enc, suffix] of [
      ['br', '.br'],
      ['gzip', '.gz'],
    ] as const) {
      if (!accept.includes(enc)) continue;
      const compressed = Bun.file(filePath + suffix);
      if (await compressed.exists()) {
        headers.set('Content-Encoding', enc);
        headers.set('Vary', 'Accept-Encoding');
        return new Response(compressed, { headers });
      }
    }

    return new Response(file, { headers });
  };
}
