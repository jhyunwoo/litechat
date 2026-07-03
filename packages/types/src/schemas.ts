/**
 * REST API 요청 검증용 zod 스키마 모음
 *
 * 서버는 이 스키마로 요청 본문을 검증하고, 클라이언트는 추론된 타입을 재사용한다.
 * 스키마를 한곳에 두어 검증 규칙(아이디 형식, 길이 제한 등)이
 * 서버/클라이언트 간에 어긋나지 않도록 한다.
 */
import { z } from 'zod';

/** 메시지 본문 최대 길이 (문자) */
export const MAX_MESSAGE_LENGTH = 2000;
/** 닉네임 최대 길이 */
export const MAX_NICKNAME_LENGTH = 20;
/** 업로드 허용 최대 원본 이미지 크기 (bytes) */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** 아이디 규칙: 영문 소문자/숫자/밑줄 3~20자 */
export const usernameSchema = z
  .string()
  .regex(/^[a-z0-9_]{3,20}$/, 'username must be 3-20 chars of a-z, 0-9, _');

/** 비밀번호 규칙: 8~72자 (bcrypt/argon2 입력 한계 고려) */
export const passwordSchema = z.string().min(8).max(72);

/** 회원가입 요청 */
export const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  nickname: z.string().trim().min(1).max(MAX_NICKNAME_LENGTH),
});
export type RegisterInput = z.infer<typeof registerSchema>;

/** 로그인 요청 */
export const loginSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});
export type LoginInput = z.infer<typeof loginSchema>;

/** 사용자 검색 쿼리 (?q=아이디) */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(20),
});

/** 친구 요청 보내기 */
export const friendRequestSchema = z.object({
  /** 검색으로 찾은 상대방 user ID */
  userId: z.number().int().positive(),
});
export type FriendRequestInput = z.infer<typeof friendRequestSchema>;

/** 친구 요청 응답 (수락/거절) */
export const friendRespondSchema = z.object({
  accept: z.boolean(),
});
export type FriendRespondInput = z.infer<typeof friendRespondSchema>;

/** 메시지 목록 조회 쿼리 — after: 재접속 후 따라잡기, before: 과거 페이지네이션 */
export const messagesQuerySchema = z.object({
  after: z.coerce.number().int().nonnegative().optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/** 메시지 전송 요청 (REST) — WS 프레임과 동일하게 짧은 키를 사용한다 */
export const sendMessageSchema = z.object({
  /** 메시지 종류: t(텍스트) / i(이미지 ID) / e(이모지) */
  k: z.enum(['t', 'i', 'e']),
  /** 내용 — 텍스트/이모지 본문 또는 업로드된 이미지 ID */
  x: z.string().min(1).max(MAX_MESSAGE_LENGTH),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

/** 읽음 워터마크 갱신 요청 (REST) */
export const readBodySchema = z.object({
  /** 읽은 마지막 메시지 ID */
  m: z.number().int().positive(),
});

/** Web Push 구독 등록 요청 (PushSubscription.toJSON() 형태) */
export const pushSubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});
export type PushSubscribeInput = z.infer<typeof pushSubscribeSchema>;

/** Web Push 구독 해지 요청 */
export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url(),
});
