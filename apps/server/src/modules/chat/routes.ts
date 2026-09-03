/**
 * 채팅 REST 라우트: /api/chat/*
 *
 * 실시간 경로는 WebSocket이지만, REST 경로도 완전하게 제공한다:
 *  - 대화 목록/메시지 조회 (초기 로딩, 재접속 catch-up)
 *  - 메시지 전송/읽음 처리 (WS가 끊긴 상황의 폴백)
 */
import { validator as zValidator } from 'hono-openapi/zod';
import { messagesQuerySchema, readBodySchema, sendMessageSchema } from '@litechat/types';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../app';
import type { AppDeps } from '../../deps';
import { requireAuth } from '../../middleware/auth';
import type { ChatService } from './service';

/** URL 파라미터 :id 검증 */
const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

export function chatRoutes(deps: AppDeps, service: ChatService) {
  return (
    new Hono<AppEnv>()
      .use('*', requireAuth(deps))
      // 채팅 탭: 대화 목록
      .get('/', (c) => c.json({ conversations: service.listConversations(c.var.userId) }, 200))
      // 메시지 조회 (after=catch-up / before=과거 페이지네이션)
      .get(
        '/:id/messages',
        zValidator('param', idParamSchema),
        zValidator('query', messagesQuerySchema),
        (c) => {
          const { id } = c.req.valid('param');
          // { messages, refs? } — refs는 이번 페이지 밖을 가리키는 인용 원본만 담는다.
          return c.json(service.getMessages(c.var.userId, id, c.req.valid('query')), 200);
        },
      )
      // 메시지 전송 (WS 폴백 겸 e2e 검증용)
      .post(
        '/:id/messages',
        zValidator('param', idParamSchema),
        zValidator('json', sendMessageSchema),
        (c) => {
          const { id } = c.req.valid('param');
          const { k, x, r } = c.req.valid('json');
          const message = service.sendMessage(c.var.userId, id, k, x, undefined, r);
          return c.json({ message }, 201);
        },
      )
      // 읽음 워터마크 갱신
      .post(
        '/:id/read',
        zValidator('param', idParamSchema),
        zValidator('json', readBodySchema),
        (c) => {
          const { id } = c.req.valid('param');
          const { m } = c.req.valid('json');
          return c.json(service.markRead(c.var.userId, id, m), 200);
        },
      )
  );
}
