/**
 * litechat 공용 엔티티 타입 정의
 *
 * 서버와 두 클라이언트(Full/Lite)가 공유하는 데이터 모델.
 * 네트워크 전송량 최소화가 프로젝트의 최우선 목표이므로,
 * 와이어(wire) 포맷은 의도적으로 짧은 키를 사용한다.
 * (예: `s` = sender, `k` = kind, `x` = content)
 */

/** 다른 사용자에게 노출 가능한 공개 사용자 정보 */
export interface PublicUser {
  /** 사용자 고유 ID */
  id: number;
  /** 로그인/검색에 사용하는 아이디 (소문자, 숫자, 밑줄) */
  username: string;
  /** 화면에 표시되는 별명 */
  nickname: string;
}

/** 현재 사용자가 차단한 계정 */
export interface BlockedUser {
  user: PublicUser;
  ts: number;
}

/** 친구 관계 상태: 요청 대기중 또는 수락됨 */
export type FriendshipStatus = 'pending' | 'accepted';

/** 받은/보낸 친구 요청 항목 */
export interface FriendRequestItem {
  /** friendship 레코드 ID (수락/거절 시 사용) */
  id: number;
  /** 상대방 사용자 정보 */
  user: PublicUser;
  /** 요청 생성 시각 (unix epoch 초) */
  ts: number;
}

/**
 * 메시지 종류 — 와이어 바이트 절약을 위해 한 글자 코드 사용
 * - `t`: 텍스트
 * - `i`: 이미지 (content = 이미지 ID)
 * - `e`: 이모지 (대형 이모지 렌더링용, content = 이모지 문자열)
 */
export type MessageKind = 't' | 'i' | 'e';

/** 이미지 메타데이터 — URL은 `/img/:id/thumb`, `/img/:id/orig` 로 유도한다 */
export interface WireImage {
  /** 이미지 고유 ID (랜덤 문자열) */
  id: string;
  /** 저화질 webp 기준 가로 픽셀 */
  w: number;
  /** 저화질 webp 기준 세로 픽셀 */
  h: number;
  /** 저화질 webp 파일 크기 (bytes) — Lite에서 다운로드 전 안내용 */
  tb: number;
  /** 원본 파일 크기 (bytes) */
  ob: number;
}

/**
 * 메시지 와이어 포맷 — REST 응답과 WebSocket 푸시가 동일한 형태를 사용해서
 * 클라이언트 처리 로직을 하나로 유지한다.
 */
export interface WireMessage {
  /** 메시지 ID — 대화 내 단조 증가, 읽음 워터마크 기준 */
  id: number;
  /** 대화(conversation) ID */
  c: number;
  /** 보낸 사람 user ID */
  s: number;
  /** 메시지 종류 */
  k: MessageKind;
  /** 내용 — 텍스트/이모지 본문 또는 이미지 ID */
  x: string;
  /** 생성 시각 (unix epoch 초) */
  ts: number;
  /** k === 'i' 일 때만 포함되는 이미지 메타데이터 */
  im?: WireImage;
  /** 답장 대상 메시지 ID — 항상 같은 대화 안의 메시지를 가리킨다 (답장이 아니면 없음) */
  r?: number;
}

/**
 * 인용 표시 전용 축약 메시지.
 *
 * 본문(x)은 서버가 100자로 잘라 보내므로 **메시지 목록에 병합하면 안 된다**.
 * WireMessage와 타입을 분리해 그 사고를 컴파일 타임에 막는다.
 * 닉네임은 싣지 않는다 — 1:1 대화라 s는 나 아니면 상대이고, 클라이언트가 이미
 * me와 conversation.peer를 갖고 있어 로컬에서 이름을 붙일 수 있다.
 */
export interface WireQuote {
  /** 원본 메시지 ID */
  id: number;
  /** 원본을 보낸 사람 user ID */
  s: number;
  /** 원본 메시지 종류 */
  k: MessageKind;
  /** 원본 본문 (100자로 잘림). k === 'i'면 이미지 ID이므로 표시하지 않는다 */
  x: string;
}

/** 채팅 탭에 표시할 대화 요약 */
export interface ConversationSummary {
  /** 대화 ID */
  id: number;
  /** 상대방 정보 (1:1 채팅) */
  peer: PublicUser;
  /** 마지막 메시지 (없으면 null) */
  last: WireMessage | null;
  /** 내가 읽지 않은 메시지 수 */
  unread: number;
  /** 상대방이 읽은 마지막 메시지 ID (읽음 표시용) */
  peerRead: number;
}
