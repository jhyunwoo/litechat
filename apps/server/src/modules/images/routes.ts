/**
 * 이미지 라우트
 *  - POST /api/images        : 멀티파트 업로드 (필드명 "file")
 *  - GET  /img/:id/thumb     : 저화질 webp (채팅방 기본 표시용)
 *  - GET  /img/:id/orig      : 원본 다운로드
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { validator as zValidator } from 'hono-openapi/zod';
import type { AppEnv } from '../../app';
import type { AppDeps } from '../../deps';
import { requireAuth } from '../../middleware/auth';
import { ImagesService } from './service';

const paramSchema = z.object({
  id: z.string().min(1).max(64),
  variant: z.enum(['thumb', 'orig']),
});

/** 업로드 API: /api/images */
export function imagesRoutes(deps: AppDeps, service: ImagesService) {
  return new Hono<AppEnv>().post('/', requireAuth(deps), async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: 'FILE_REQUIRED' }, 400);
    const image = await service.upload(c.var.userId, file);
    return c.json({ image }, 201);
  });
}

/** 파일 서빙: /img/:id/:variant */
export function imgRoutes(deps: AppDeps, service: ImagesService) {
  return new Hono<AppEnv>().get(
    '/:id/:variant',
    requireAuth(deps),
    zValidator('param', paramSchema),
    (c) => {
      const { id, variant } = c.req.valid('param');
      const file = service.getFile(c.var.userId, id, variant);
      return new Response(Bun.file(file.path), {
        headers: {
          'Content-Type': file.contentType,
          // 이미지 내용은 절대 바뀌지 않으므로 브라우저가 영구 캐시하게 한다.
          'Cache-Control': 'private, max-age=31536000, immutable',
          // orig는 저장(다운로드) UX를 위해 파일명을 지정한다. thumb은 인라인 표시.
          ...(variant === 'orig'
            ? { 'Content-Disposition': `attachment; filename="${file.downloadName}"` }
            : {}),
        },
      });
    },
  );
}
