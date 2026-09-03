/**
 * 데이터 계층 — react-query 캐시와 WebSocket 프레임을 잇는다.
 * apps/web/src/data.ts의 포팅 (전송/캐시 로직은 플랫폼 독립적이라 그대로다).
 *
 * 캐시 키:
 *   ['conversations']      대화 목록 (ConversationSummary[])
 *   ['messages', convId]   대화별 메시지 (WireMessage[], 오름차순)
 *   ['friends'] ['requests'] 친구 데이터
 *
 * 실시간 프레임은 useRealtimeSync가 받아 캐시를 직접 갱신한다.
 * → 추가 REST 호출 없이 화면이 즉시 반영된다 (트래픽 절약 + 저지연).
 */
import type {
  ConversationSummary,
  MessageKind,
  ServerFrame,
  WireMessage,
  WireQuote,
} from '@litechat/types';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api, unwrap } from '@/lib/api';
import { socket } from '@/lib/ws';
import { useAuth } from './auth';

/** 페이지당 메시지 수 */
const PAGE_SIZE = 30;

/** QueryClient/대화별 과거 페이지 요청 — 같은 커서의 중복 요청을 하나로 합친다. */
const olderMessageRequests = new WeakMap<QueryClient, Map<number, Promise<boolean>>>();

/**
 * 대화별 인용 원본 캐시 — /messages 응답의 refs를 모은다.
 *
 * 본문이 100자로 잘려 있으므로 ['messages'] 캐시(진짜 메시지 배열)와 절대 섞지 않는다.
 * 채팅방을 나가도 유지한다 — 재진입 시 같은 원본을 다시 받지 않기 위해서다.
 */
const quoteCache = new Map<number, Map<number, WireQuote>>();

/** /messages 응답의 refs를 캐시에 병합한다 */
export function cacheQuotes(convId: number, refs: WireQuote[] | undefined): void {
  if (!refs?.length) return;
  let quotes = quoteCache.get(convId);
  if (!quotes) {
    quotes = new Map();
    quoteCache.set(convId, quotes);
  }
  for (const quote of refs) quotes.set(quote.id, quote);
}

/** 캐시된 인용 원본 조회 (없으면 undefined) */
export function getQuote(convId: number, id: number): WireQuote | undefined {
  return quoteCache.get(convId)?.get(id);
}

/* ------------------------------------------------------------------ */
/* 조회 훅                                                              */
/* ------------------------------------------------------------------ */

export function useConversations() {
  return useQuery({
    queryKey: ['conversations'],
    queryFn: async () => {
      const res = await api.api.chat.$get();
      return (await unwrap<{ conversations: ConversationSummary[] }>(res)).conversations;
    },
  });
}

export function useMessages(convId: number) {
  return useQuery({
    queryKey: ['messages', convId],
    queryFn: async () => {
      const res = await api.api.chat[':id'].messages.$get({
        param: { id: String(convId) },
        query: { limit: String(PAGE_SIZE) },
      });
      const { messages, refs } = await unwrap<{ messages: WireMessage[]; refs?: WireQuote[] }>(res);
      cacheQuotes(convId, refs);
      return messages;
    },
    staleTime: Infinity, // WS가 실시간 갱신하므로 재조회 불필요
  });
}

export function useFriends() {
  return useQuery({
    queryKey: ['friends'],
    queryFn: async () => {
      const res = await api.api.friends.$get();
      return (await unwrap<{ friends: { user: ConversationSummary['peer']; c: number }[] }>(res))
        .friends;
    },
  });
}

export function useFriendRequests() {
  return useQuery({
    queryKey: ['requests'],
    queryFn: async () => {
      const res = await api.api.friends.requests.$get();
      return unwrap<{
        incoming: { id: number; user: ConversationSummary['peer'] }[];
        outgoing: { id: number; user: ConversationSummary['peer'] }[];
      }>(res);
    },
  });
}

/* ------------------------------------------------------------------ */
/* 메시지 전송 (낙관적 갱신)                                             */
/* ------------------------------------------------------------------ */

/** 전송 대기 중인 임시 ID → 대화방 매핑 (ack 프레임에는 대화 ID가 없어서 필요) */
const pendingSends = new Map<string, number>();

/**
 * 메시지를 보낸다.
 * 1) 임시 메시지를 캐시에 즉시 추가 (낙관적 UI)
 * 2) WS로 전송, 소켓이 닫혀 있으면 REST 폴백
 * 3) ack가 오면 handleFrame이 임시 → 실제 메시지로 교체
 */
export async function sendMessage(
  queryClient: QueryClient,
  meId: number,
  convId: number,
  kind: MessageKind,
  content: string,
  /** 답장 대상 메시지 ID (선택) */
  replyTo?: number,
): Promise<void> {
  const tempKey = `t${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
  const optimistic: WireMessage = {
    id: -Date.now(), // 음수 = 아직 서버 확인 전
    c: convId,
    s: meId,
    k: kind,
    x: content,
    ts: Math.floor(Date.now() / 1000),
    ...(replyTo !== undefined ? { r: replyTo } : {}),
  };
  pendingSends.set(tempKey, convId);
  appendMessage(queryClient, optimistic, tempKey);

  const sentViaWs = socket.send({
    t: 'm',
    c: convId,
    k: kind,
    x: content,
    i: tempKey,
    ...(replyTo !== undefined ? { r: replyTo } : {}),
  });
  if (!sentViaWs) {
    // WS가 끊긴 동안에도 전송은 가능해야 한다 → REST 폴백
    try {
      const res = await api.api.chat[':id'].messages.$post({
        param: { id: String(convId) },
        json: { k: kind, x: content, ...(replyTo !== undefined ? { r: replyTo } : {}) },
      });
      const { message } = await unwrap<{ message: WireMessage }>(res);
      confirmMessage(queryClient, tempKey, message.id, message.ts, message.im);
    } catch (error) {
      removeMessage(queryClient, convId, tempKey);
      throw error;
    }
  }
}

/** 읽음 처리 — 캐시의 내 unread를 0으로 만들고 서버에 워터마크를 보낸다 */
export function markRead(queryClient: QueryClient, convId: number, messageId: number): void {
  if (messageId <= 0) return;
  updateConversation(queryClient, convId, (conv) => ({ ...conv, unread: 0 }));
  if (!socket.send({ t: 'r', c: convId, m: messageId })) {
    void api.api.chat[':id'].read.$post({ param: { id: String(convId) }, json: { m: messageId } });
  }
}

/* ------------------------------------------------------------------ */
/* 캐시 조작 헬퍼                                                        */
/* ------------------------------------------------------------------ */

/** 임시 키를 메시지 객체에 몰래 붙여 ack 때 찾아낸다 */
const tempKeys = new WeakMap<WireMessage, string>();

function appendMessage(queryClient: QueryClient, message: WireMessage, tempKey?: string): void {
  if (tempKey) tempKeys.set(message, tempKey);
  queryClient.setQueryData<WireMessage[]>(['messages', message.c], (old) =>
    old ? [...old, message] : old,
  );
  // 대화 목록의 미리보기도 갱신한다.
  updateConversation(queryClient, message.c, (conv) => ({ ...conv, last: message }));
}

/** ack 수신: 임시 메시지를 실제 ID/시각으로 교체 */
function confirmMessage(
  queryClient: QueryClient,
  tempKey: string,
  id: number,
  ts: number,
  im?: WireMessage['im'],
): void {
  const convId = pendingSends.get(tempKey);
  if (convId === undefined) return;
  pendingSends.delete(tempKey);
  queryClient.setQueryData<WireMessage[]>(['messages', convId], (old) =>
    old?.map((m) => (tempKeys.get(m) === tempKey ? { ...m, id, ts, ...(im ? { im } : {}) } : m)),
  );
}

/** 전송 실패한 임시 메시지 제거 */
function removeMessage(queryClient: QueryClient, convId: number, tempKey: string): void {
  pendingSends.delete(tempKey);
  queryClient.setQueryData<WireMessage[]>(['messages', convId], (old) =>
    old?.filter((m) => tempKeys.get(m) !== tempKey),
  );
}

function updateConversation(
  queryClient: QueryClient,
  convId: number,
  update: (conv: ConversationSummary) => ConversationSummary,
): void {
  queryClient.setQueryData<ConversationSummary[]>(['conversations'], (old) =>
    old?.map((conv) => (conv.id === convId ? update(conv) : conv)),
  );
}

/* ------------------------------------------------------------------ */
/* 실시간 동기화                                                         */
/* ------------------------------------------------------------------ */

/** 서버 프레임 → 캐시 반영 (테스트를 위해 export) */
export function handleFrame(queryClient: QueryClient, meId: number, frame: ServerFrame): void {
  switch (frame.t) {
    case 'm': {
      const { t: _t, ...message } = frame;
      appendMessage(queryClient, message);
      if (message.s !== meId) {
        // 다른 사람의 메시지 → 안읽음 수 증가 (채팅방 화면이 열려 있으면 즉시 읽음 처리한다)
        updateConversation(queryClient, message.c, (conv) => ({
          ...conv,
          unread: conv.unread + 1,
        }));
      }
      // 목록에 아직 없는 새 대화방이면 목록을 다시 불러온다.
      const conversations = queryClient.getQueryData<ConversationSummary[]>(['conversations']);
      if (conversations && !conversations.some((c) => c.id === message.c)) {
        void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      }
      break;
    }
    case 'a':
      confirmMessage(queryClient, frame.i, frame.id, frame.ts, frame.im);
      break;
    case 'r':
      // 상대방 읽음 워터마크 전진 → "읽음" 표시 갱신
      updateConversation(queryClient, frame.c, (conv) => ({ ...conv, peerRead: frame.m }));
      break;
    case 'f':
      // 친구 요청/수락 — 관련 목록을 다시 불러온다.
      void queryClient.invalidateQueries({ queryKey: ['requests'] });
      void queryClient.invalidateQueries({ queryKey: ['friends'] });
      if (frame.k === 'acc') void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      break;
    case 'e':
      if (frame.i) {
        // 전송 실패 — 임시 메시지를 제거한다.
        const convId = pendingSends.get(frame.i);
        if (convId !== undefined) removeMessage(queryClient, convId, frame.i);
      }
      break;
  }
}

/**
 * 실시간 동기화 훅 — 로그인된 화면 트리에서 한 번만 마운트한다.
 * WS 프레임을 캐시에 반영하고, 재연결 시 서버 상태를 다시 불러온다.
 */
export function useRealtimeSync(): void {
  const queryClient = useQueryClient();
  const { me } = useAuth();

  useEffect(() => {
    if (!me) return;
    const offFrame = socket.onFrame((frame) => handleFrame(queryClient, me.id, frame));
    const offReconnect = socket.onReconnect(() => {
      // 끊긴 동안의 변경을 따라잡는다. 목록류는 통째로 다시 받고(작다),
      // 메시지는 증분(after=)으로만 받는다 — 모바일은 재연결이 잦다.
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['requests'] });
      void catchUpMessages(queryClient);
    });
    return () => {
      offFrame();
      offReconnect();
    };
  }, [me, queryClient]);
}

/**
 * 재연결 catch-up — 열려 있는 대화방의 밀린 메시지만 증분으로 가져온다.
 *
 * 이전에는 ['messages']를 invalidate해 활성 쿼리를 통째로 다시 받았다. 끊김이 잦은
 * 모바일 회선에서는 재연결마다 최근 30개(≈5 KB)를 다시 내려받는 셈이고, 사용자가
 * 위로 스크롤해 불러 둔 과거 페이지도 함께 버려졌다.
 * `after=<마지막 id>`로 바꾸면 보통은 빈 배열(수십 바이트)만 오가고, 이미 불러 둔
 * 히스토리와 스크롤 위치도 그대로 유지된다.
 */
async function catchUpMessages(queryClient: QueryClient): Promise<void> {
  const active = queryClient
    .getQueryCache()
    .findAll({ queryKey: ['messages'], type: 'active' });

  await Promise.all(
    active.map(async (query) => {
      const convId = query.queryKey[1];
      if (typeof convId !== 'number') return;
      const cached = queryClient.getQueryData<WireMessage[]>(['messages', convId]);
      // 서버가 확정한(양수 id) 마지막 메시지가 없으면 평소대로 다시 조회한다.
      let lastId = 0;
      for (let i = (cached?.length ?? 0) - 1; i >= 0; i--) {
        const id = cached![i]!.id;
        if (id > 0) {
          lastId = id;
          break;
        }
      }
      if (lastId === 0) {
        await queryClient.invalidateQueries({ queryKey: ['messages', convId] });
        return;
      }
      try {
        const res = await api.api.chat[':id'].messages.$get({
          param: { id: String(convId) },
          query: { after: String(lastId) },
        });
        const { messages, refs } = await unwrap<{
          messages: WireMessage[];
          refs?: WireQuote[];
        }>(res);
        cacheQuotes(convId, refs);
        if (messages.length === 0) return;
        queryClient.setQueryData<WireMessage[]>(['messages', convId], (old) => {
          if (!old) return messages;
          const seen = new Set(old.map((message) => message.id));
          const fresh = messages.filter((message) => !seen.has(message.id));
          return fresh.length > 0 ? [...old, ...fresh] : old;
        });
      } catch {
        // 따라잡기에 실패하면 다음 재연결에서 다시 시도한다 — 화면을 막지 않는다.
      }
    }),
  );
}

/** 과거 메시지 페이지 로드 (위로 스크롤 시) — 더 없으면 false 반환 */
export async function loadOlderMessages(
  queryClient: QueryClient,
  convId: number,
): Promise<boolean> {
  let requests = olderMessageRequests.get(queryClient);
  if (!requests) {
    requests = new Map();
    olderMessageRequests.set(queryClient, requests);
  }

  const pending = requests.get(convId);
  if (pending) return pending;

  const request = (async () => {
    try {
      const current = queryClient.getQueryData<WireMessage[]>(['messages', convId]);
      const oldest = current?.find((m) => m.id > 0);
      if (!oldest) return false;
      const res = await api.api.chat[':id'].messages.$get({
        param: { id: String(convId) },
        query: { before: String(oldest.id), limit: String(PAGE_SIZE) },
      });
      const { messages, refs } = await unwrap<{ messages: WireMessage[]; refs?: WireQuote[] }>(res);
      cacheQuotes(convId, refs);
      if (messages.length === 0) return false;

      let added = false;
      queryClient.setQueryData<WireMessage[]>(['messages', convId], (old) => {
        if (!old) {
          added = messages.length > 0;
          return messages;
        }
        const seen = new Set(old.map((message) => message.id));
        const uniqueOlder = messages.filter((message) => {
          if (seen.has(message.id)) return false;
          seen.add(message.id);
          return true;
        });
        added = uniqueOlder.length > 0;
        return added ? [...uniqueOlder, ...old] : old;
      });
      return added;
    } finally {
      requests.delete(convId);
    }
  })();

  requests.set(convId, request);
  return request;
}
