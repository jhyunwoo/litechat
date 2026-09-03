/**
 * 정적 파일 서빙 + Host 헤더 기반 프론트엔드 라우팅
 *
 * 하나의 컨테이너가 네 도메인을 모두 서빙한다:
 *   - chat.moveto.kr     → apps/web       빌드 산출물 (Full Chat)
 *   - litechat.moveto.kr → apps/lite      빌드 산출물 (Lite Chat)
 *   - lc.moveto.kr       → apps/lite      빌드 산출물 (Lite Chat 별칭)
 *   - dash.moveto.kr     → apps/dashboard 빌드 산출물 (관리자 대시보드)
 *
 * 전송량 최소화를 위한 규칙:
 *   - 빌드 시 생성된 사전 압축 파일(.br, .gz)이 있으면 그대로 전송 (재압축 비용 0)
 *   - 해시가 붙은 자산(/assets/*)은 immutable 캐시 → 재방문 시 전송량 0
 *   - SPA 라우팅: 파일이 없으면 index.html 반환
 */
import type { BunFile } from 'bun';
import type { MiddlewareHandler } from 'hono';
import { join, extname } from 'node:path';
import type { AppEnv } from './app';
import type { AppConfig } from './config';
import type { AppDeps } from './deps';
import { ensureVisitorCookies } from './modules/analytics/cookies';
import type { AnalyticsService } from './modules/analytics/service';

/** 사전 압축 후보 — 우선순위 순 (Accept-Encoding 토큰, 파일 접미사) */
const ENCODINGS = [
  ['br', '.br'],
  ['gzip', '.gz'],
] as const;

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

/** 포트와 대소문자 차이를 무시하고 Lite 기본/별칭 호스트인지 판별한다. */
export function isLiteFrontendHost(
  hostHeader: string | undefined,
  config: Pick<AppConfig, 'liteHost' | 'liteHostAliases'>,
): boolean {
  const host = (hostHeader ?? '').split(':')[0]?.trim().toLowerCase() ?? '';
  return [config.liteHost, ...config.liteHostAliases].some(
    (candidate) => candidate.toLowerCase() === host,
  );
}

/**
 * 요청 Host에 따라 web/lite/dashboard 정적 디렉터리에서 파일을 서빙하는 미들웨어를 만든다.
 * API/WS/이미지 경로 뒤에 마지막 핸들러로 등록해야 한다.
 *
 * analyticsService는 lite 사이트의 서버사이드 전용 수집 훅에 쓰인다 — lite는 클라이언트 JS를
 * 전혀 추가하지 않으므로, 문서 최초 로드(index.html 응답) 시점에 서버가 직접 한 번만 기록한다.
 */
export function serveFrontend(
  deps: AppDeps,
  analyticsService: AnalyticsService,
): MiddlewareHandler<AppEnv> {
  const { config } = deps;

  /**
   * 실제로 전송할 파일을 고른다.
   *
   * 사전 압축본을 **먼저** 확인하는 것이 핵심이다. `<file>.br`은 빌드가 실제 파일 옆에만
   * 만들므로, 그 존재 자체가 원본의 존재를 증명한다 → stat 한 번으로 끝난다.
   * (원본 stat → 압축본 stat 순서로 확인하면 자산 요청마다 stat이 두 번 필요하고,
   *  실측에서 자산 응답 지연이 0.4ms → 1.3ms로 늘었다.)
   */
  async function pick(
    filePath: string,
    accept: string,
  ): Promise<{ body: BunFile; encoding: string | null } | null> {
    for (const [token, suffix] of ENCODINGS) {
      if (!accept.includes(token)) continue;
      const compressed = Bun.file(filePath + suffix);
      if (await compressed.exists()) return { body: compressed, encoding: token };
    }
    const plain = Bun.file(filePath);
    return (await plain.exists()) ? { body: plain, encoding: null } : null;
  }

  return async (c) => {
    // Host 헤더에서 포트를 제거해 사이트를 구분한다. 그 외(chat 도메인, localhost 등)는
    // 기본적으로 Full Chat을 서빙한다.
    const hostHeader = c.req.header('host');
    const host = (hostHeader ?? '').split(':')[0]?.trim().toLowerCase() ?? '';
    const isLite = isLiteFrontendHost(hostHeader, config);
    const root = isLite
      ? config.liteStaticDir
      : host === config.dashboardHost
        ? config.dashboardStaticDir
        : config.webStaticDir;

    // 경로 정규화 — 디렉터리 탈출(..) 차단
    let pathname = decodeURIComponent(new URL(c.req.url).pathname);
    if (pathname.includes('..')) return c.text('Bad Request', 400);
    if (pathname.endsWith('/')) pathname += 'index.html';

    const accept = c.req.header('accept-encoding') ?? '';
    let filePath = join(root, pathname);
    let selected = await pick(filePath, accept);
    let isDocument = extname(filePath) === '.html';

    // SPA fallback: 존재하지 않는 경로는 index.html로 (클라이언트 라우팅)
    if (!selected) {
      filePath = join(root, 'index.html');
      isDocument = true;
      selected = await pick(filePath, accept);
      if (!selected) return c.text('Not Found', 404);
    }

    const headers = new Headers({
      'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
      // 인코딩 협상 대상이므로 압축 여부와 무관하게 항상 Vary를 붙인다. 압축 응답에만
      // 붙이면 중간 캐시(Traefik/CDN)가 비압축 응답을 Vary 없이 저장해 버릴 수 있다.
      Vary: 'Accept-Encoding',
    });
    if (selected.encoding) headers.set('Content-Encoding', selected.encoding);

    // lite는 클라이언트 수집 스크립트가 없으므로, 문서 요청(최초 로드/SPA 폴백)마다
    // 서버가 직접 한 번 기록한다. 쿠키(lc_vid/lc_sid)는 여기서 동기적으로 발급하고,
    // c.header가 쌓아 둔 Set-Cookie를 아래에서 직접 만드는 Response로 옮겨 담는다
    // (파일은 스트리밍을 위해 c.body가 아니라 new Response(BunFile, ...)로 반환하므로,
    // c에 쌓인 헤더가 자동으로 실리지 않는다). DB 기록 자체는 await하지 않아 응답을 지연시키지 않는다.
    if (isLite && isDocument) {
      const identity = ensureVisitorCookies(c, deps);
      void analyticsService.recordLiteDocumentLoad(c, identity, pathname);
      for (const cookie of c.res.headers.getSetCookie()) {
        headers.append('Set-Cookie', cookie);
      }
    }

    // 해시 파일명 자산은 1년 immutable — 재방문 시 네트워크 요청조차 없음
    if (pathname.startsWith('/assets/')) {
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      // HTML 등은 항상 재검증 (배포 즉시 반영).
      // no-cache는 "쓰기 전에 재검증하라"는 뜻이라 검증자(ETag)가 있어야 의미가 있다.
      // 검증자가 없으면 브라우저는 매번 본문을 통째로 다시 받는다. 정적 산출물은
      // 배포 단위로만 바뀌므로 크기+수정시각으로 만든 약한 ETag면 충분하다.
      // (인코딩마다 다른 파일을 재므로 ETag도 인코딩별로 자연히 달라진다 → Vary와 정합)
      headers.set('Cache-Control', 'no-cache');
      const { size, lastModified } = selected.body;
      const etag = `W/"${size.toString(16)}-${Math.floor(lastModified).toString(16)}"`;
      headers.set('ETag', etag);
      if (c.req.header('if-none-match') === etag) {
        return new Response(null, { status: 304, headers });
      }
    }

    return new Response(selected.body, { headers });
  };
}
