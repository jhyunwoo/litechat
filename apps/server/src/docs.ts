/**
 * API 문서 자동 생성 (Hono Stack)
 *
 * hono-openapi가 각 라우트의 zod 검증 스키마에서 OpenAPI 3.1 명세를 만들어 낸다.
 *  - GET /openapi.json : 명세 원문
 *  - GET /docs         : Scalar 기반 문서 UI
 */
import type { Hono } from 'hono';
import { openAPISpecs } from 'hono-openapi';
import type { AppEnv } from './app';

/** 문서 UI 페이지 — Scalar를 CDN에서 로드하는 최소 HTML */
const DOCS_HTML = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LiteChat API 문서</title>
</head>
<body>
  <script id="api-reference" data-url="/openapi.json"></script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>`;

/** 앱에 문서 엔드포인트를 붙인다 (라우트 등록이 모두 끝난 뒤 호출할 것). */
export function attachDocs(app: Hono<AppEnv>): void {
  app.get(
    '/openapi.json',
    openAPISpecs(app, {
      documentation: {
        info: {
          title: 'LiteChat API',
          version: '1.0.0',
          description:
            '초저용량 실시간 채팅 서비스 API. 실시간 경로는 GET /ws (WebSocket, ' +
            '프로토콜은 @litechat/types의 protocol.ts 참고).',
        },
        tags: [
          { name: 'auth', description: '인증 (가입/로그인/세션)' },
          { name: 'friends', description: '친구 검색/요청/수락' },
          { name: 'chat', description: '대화/메시지/읽음' },
          { name: 'images', description: '이미지 업로드/서빙' },
          { name: 'push', description: 'Web Push 구독' },
        ],
      },
    }),
  );

  app.get('/docs', (c) => c.html(DOCS_HTML));
}
