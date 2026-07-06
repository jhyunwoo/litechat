/**
 * litechat WebSocket 실시간 프로토콜 정의
 *
 * 모든 프레임은 한 줄 JSON이며 `t` 필드로 종류를 구분한다.
 * 초저용량 목표를 위해 모든 키는 한 글자이다.
 *
 * 프레임 종류 요약:
 *   클라이언트 → 서버 : m(메시지 전송), r(읽음 처리), p(핑)
 *   서버 → 클라이언트: m(새 메시지), a(전송 확인), r(상대 읽음), f(친구 이벤트), q(퐁), e(오류)
 */
import type { MessageKind, PublicUser, WireMessage } from './entities';

/* -------------------------------------------------------------- */
/* 클라이언트 → 서버                                                */
/* -------------------------------------------------------------- */

/** 메시지 전송 요청 */
export interface ClientSendFrame {
  t: 'm';
  /** 대화 ID */
  c: number;
  /** 메시지 종류 */
  k: MessageKind;
  /** 내용 (텍스트/이모지 본문 또는 업로드된 이미지 ID) */
  x: string;
  /** 클라이언트 임시 ID — ack(`a`) 프레임으로 실제 ID와 매칭된다 */
  i: string;
}

/** 읽음 워터마크 갱신 — "대화 c를 메시지 m까지 읽었다" */
export interface ClientReadFrame {
  t: 'r';
  c: number;
  /** 읽은 마지막 메시지 ID */
  m: number;
}

/** 연결 유지 핑 (브라우저는 WS ping 프레임을 보낼 수 없으므로 앱 레벨로 처리) */
export interface ClientPingFrame {
  t: 'p';
}

export type ClientFrame = ClientSendFrame | ClientReadFrame | ClientPingFrame;

/* -------------------------------------------------------------- */
/* 서버 → 클라이언트                                                */
/* -------------------------------------------------------------- */

/** 새 메시지 수신 — WireMessage를 평탄화(flatten)하여 그대로 사용 */
export type ServerMessageFrame = { t: 'm' } & WireMessage;

/** 전송 확인(ack) — 임시 ID `i`가 실제 메시지 `id`로 저장되었음 */
export interface ServerAckFrame {
  t: 'a';
  /** 클라이언트가 보낸 임시 ID */
  i: string;
  /** 저장된 실제 메시지 ID */
  id: number;
  /** 서버 기준 생성 시각 (unix epoch 초) */
  ts: number;
  /** k === 'i' 일 때 이미지 메타데이터 */
  im?: WireMessage['im'];
}

/** 상대방 읽음 알림 — "대화 c에서 사용자 u가 메시지 m까지 읽음" */
export interface ServerReadFrame {
  t: 'r';
  c: number;
  u: number;
  m: number;
}

/**
 * 친구 이벤트
 * - k: 'req' 새 친구 요청 도착
 * - k: 'acc' 내 요청이 수락됨 (c = 새로 생성된 대화 ID)
 */
export interface ServerFriendFrame {
  t: 'f';
  k: 'req' | 'acc';
  u: PublicUser;
  c?: number;
}

/** 핑에 대한 퐁 응답 */
export interface ServerPongFrame {
  t: 'q';
}

/** 오류 통지 — i가 있으면 해당 전송 시도가 실패했음을 의미 */
export interface ServerErrorFrame {
  t: 'e';
  /** 오류 메시지 코드 (사람이 읽을 수 있는 짧은 문자열) */
  m: string;
  /** 실패한 클라이언트 임시 ID (전송 실패 시) */
  i?: string;
}

export type ServerFrame =
  | ServerMessageFrame
  | ServerAckFrame
  | ServerReadFrame
  | ServerFriendFrame
  | ServerPongFrame
  | ServerErrorFrame;

/** 수신 문자열을 안전하게 파싱한다. 형식이 다르면 null을 반환한다. */
export function parseFrame<T extends { t: string }>(raw: unknown): T | null {
  if (typeof raw !== 'string') return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (value && typeof value === 'object' && typeof (value as { t?: unknown }).t === 'string') {
      return value as T;
    }
    return null;
  } catch {
    return null;
  }
}
