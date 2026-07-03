/**
 * 친구 REST 라우트: /api/friends/*
 */
import { validator as zValidator } from 'hono-openapi/zod';
import { friendRequestSchema, friendRespondSchema, searchQuerySchema } from '@litechat/types';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../app';
import type { AppDeps } from '../../deps';
import { requireAuth } from '../../middleware/auth';
import { FriendsService } from './service';

/** URL 파라미터 :id 검증 */
const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

export function friendsRoutes(deps: AppDeps) {
  const service = new FriendsService(deps);

  return (
    new Hono<AppEnv>()
      // 모든 친구 API는 로그인 필수
      .use('*', requireAuth(deps))
      // 아이디로 사용자 검색
      .get('/search', zValidator('query', searchQuerySchema), (c) => {
        const { q } = c.req.valid('query');
        return c.json({ users: service.search(c.var.userId, q) }, 200);
      })
      // 친구 목록 (대화방 ID 포함)
      .get('/', (c) => c.json({ friends: service.listFriends(c.var.userId) }, 200))
      // 받은/보낸 대기중 요청 목록
      .get('/requests', (c) => c.json(service.listRequests(c.var.userId), 200))
      // 친구 요청 보내기
      .post('/requests', zValidator('json', friendRequestSchema), (c) => {
        const { userId } = c.req.valid('json');
        return c.json(service.sendRequest(c.var.userId, userId), 201);
      })
      // 요청 수락/거절
      .post(
        '/requests/:id/respond',
        zValidator('param', idParamSchema),
        zValidator('json', friendRespondSchema),
        (c) => {
          const { id } = c.req.valid('param');
          const { accept } = c.req.valid('json');
          return c.json(service.respond(c.var.userId, id, accept), 200);
        },
      )
  );
}
