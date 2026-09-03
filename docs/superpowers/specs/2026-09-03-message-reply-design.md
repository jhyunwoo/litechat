# 메시지 답장(reply) 설계

## 배경

지금은 메시지를 보낼 때 "어떤 메시지에 대한 이야기인지"를 표현할 방법이 없다.
대화가 빠르게 오가면 맥락이 끊기고, 특히 저속 회선 사용자는 메시지가 몰아서 도착하는 일이
잦아 맥락 소실이 더 크다.

기존 구조를 점검한 결과, 답장은 다음 네 지점을 동시에 건드린다:

- `packages/types` — `WireMessage` 와이어 포맷과 WS 프레임 정의(`protocol.ts`),
  REST 요청 스키마(`schemas.ts`)
- `apps/server` — `messages` 테이블 스키마, `MessagesRepo`, `ChatService`
- 클라이언트 3종 — `apps/web`(React), `apps/lite`(무프레임워크, brotli 10 KB 예산),
  `apps/app`(Expo React Native)
- `e2e` — Playwright 종단 테스트

즉 단일 파일 변경이 아니라 인터페이스 변경이므로, 와이어 포맷을 먼저 못박고 나머지를
그 위에 얹는다.

## 목표

- 상대 메시지와 내 메시지 모두에 답장할 수 있다.
- 모바일에서는 스와이프로 답장 대상을 고른다 — 상대 메시지는 왼쪽→오른쪽,
  내 메시지는 오른쪽→왼쪽.
- 데스크톱에서는 말풍선 호버 버튼과 키보드 단축키로 답장한다.
- 말풍선 안의 인용문을 탭하면 원본 메시지로 이동한다 (필요하면 과거 메시지를 불러온다).
- web / lite / app 세 클라이언트 모두에서 동작한다.
- 추가되는 전송량을 최소화한다 — 프로젝트의 1순위 목표(PROJECT.md)를 답장 기능이
  갉아먹지 않아야 한다.

## 비목표

- 메시지 수정/삭제 — 현재 서비스에 없는 기능이며 답장의 전제도 아니다.
  (원본이 불변이므로 인용문이 원본과 어긋날 일이 없다.)
- 스레드(대화 분기) — 답장은 어디까지나 단일 타임라인 안의 인용이다.
- 여러 메시지에 동시 답장, 답장에 대한 답장 체인 표시(1단계만 표시한다).
- 대화 목록(`listConversations`)의 마지막 메시지 미리보기에 인용문 표시 — 한 줄
  미리보기라 인용문을 넣을 자리가 없다.

## 와이어 포맷 결정

핵심 갈림길은 "인용 대상을 어떻게 실어 보내는가"였다. 세 안을 비교했다.

| 안 | 전송량 | 왕복 | 클라이언트 복잡도 |
| --- | --- | --- | --- |
| A. `r`(ID)만 + 서버가 부족한 원본을 `refs`로 동봉 | 최소 | 0 | 중 (서버가 흡수) |
| B. 인용 스냅샷을 메시지마다 동봉 | 답장당 60~90 B, 히스토리 로드마다 반복 | 0 | 최소 |
| C. `r`만 보내고 클라이언트가 못 찾으면 별도 요청 | 최소 | +1 (방 진입 시) | 높음 (3종에 각각) |

**A안을 채택한다.** B안은 클라이언트 코드가 가장 단순하지만 같은 바이트를 히스토리
로드마다 반복 전송하므로 "인터넷 사용량 절감이 최우선"이라는 프로젝트 전제와 정면으로
충돌한다. C안은 전송량은 A안과 비슷하나 왕복이 늘고, 미해결 처리 로직을 web/lite/app에
각각 구현해야 한다. A안은 그 로직을 서버 한 곳에 모아 세 클라이언트가 같은 규칙을
공유하게 한다.

## 데이터 모델

마이그레이션 v9 → v10 (`apps/server/src/db/migrations.ts`에 항목 추가):

```sql
-- v9 → v10: 답장 — 메시지가 같은 대화 안의 다른 메시지를 인용한다.
-- 조회는 항상 PK(m.id IN (...))로만 일어나고 "이 메시지에 달린 답장 전부" 같은
-- 역방향 질의가 없으므로 인덱스를 만들지 않는다.
ALTER TABLE messages ADD COLUMN reply_to_id INTEGER REFERENCES messages(id);
```

`ALTER TABLE ... ADD COLUMN`은 기본값이 NULL이므로 기존 행은 그대로 답장 없음
(`r` 미포함)이 된다.

**매달린 참조가 생기지 않는 이유**: 계정 삭제(`modules/auth/service.ts`)는 해당 사용자가
속한 대화의 메시지를 통째로 지우고, 인용은 항상 같은 대화 안이므로 대상만 남거나
사라지는 상황이 없다. 보관기간 정책(`db/retention.ts`)도 메시지를 지우지 않는다.

## 공유 타입 (`packages/types`)

`entities.ts`:

```ts
export interface WireMessage {
  // ... 기존 필드
  /** 답장 대상 메시지 ID — 항상 같은 대화 안의 메시지를 가리킨다 */
  r?: number;
}

/**
 * 인용 표시 전용 축약 메시지.
 * 본문(x)은 서버가 100자로 잘라 보내므로 메시지 목록에 병합하면 안 된다.
 * 타입을 분리해 그 사고를 컴파일 타임에 막는다.
 */
export interface WireQuote {
  id: number;
  s: number;
  k: MessageKind;
  x: string;
}
```

닉네임은 싣지 않는다. 1:1 대화이므로 `s`는 나 아니면 상대이고, 클라이언트는 이미
`me`와 `conversation.peer`를 갖고 있어 로컬에서 이름을 붙일 수 있다.

`schemas.ts`:

```ts
export const sendMessageSchema = z.object({
  k: z.enum(['t', 'i', 'e']),
  x: z.string().min(1).max(MAX_MESSAGE_LENGTH),
  /** 답장 대상 메시지 ID (선택) */
  r: z.number().int().positive().optional(),
});
```

`protocol.ts`:

- `ClientSendFrame`에 `r?: number` 추가, `clientFrameSchema`의 `'m'` 분기에
  `r: z.number().int().positive().optional()` 추가.
- `ServerMessageFrame`은 `{ t: 'm' } & WireMessage`이므로 자동으로 `r`을 갖는다.
- `ServerAckFrame`은 변경하지 않는다 — 보낸 쪽은 자신이 무엇에 답장했는지 이미 안다.
- `MAX_WS_FRAME_BYTES`(8 KiB)는 그대로. `r` 필드는 최대 십수 바이트다.

옵셔널 필드이므로 답장이 아닌 메시지의 전송량은 **변하지 않는다**.

## 서버

### `MessagesRepo` (`modules/chat/messages-repo.ts`)

- `SELECT_WITH_IMAGE`에 `m.reply_to_id` 추가, `MessageJoinRow`에 `reply_to_id: number | null`.
- `toWire()`가 `reply_to_id`가 있으면 `r`에 채운다.
- `insert(conversationId, senderId, kind, content, replyToId?)` — 인자 추가.
- 신설: `listQuotes(conversationId, ids: number[]): WireQuote[]`

인용 본문 상한 `QUOTE_MAX_CHARS = 100`은 이 파일에 둔다. 클라이언트는 어차피 CSS로
한 줄 말줄임을 하므로 값을 알 필요가 없고, `service.ts`의 `PREVIEW_MAX_CHARS`가
서버 안에 사는 것과 같은 이유다 (공유 패키지에 두면 쓰지도 않는 상수가 세 클라이언트
번들에 딸려 들어간다).

```sql
SELECT m.id, m.sender_id, m.kind, substr(m.content, 1, ?) AS content
FROM messages m
WHERE m.conversation_id = ? AND m.id IN (...)
```

`conversation_id` 조건이 **보안 경계**다. 이게 없으면 남의 대화 메시지 ID를 찍어
본문 앞 100자를 긁어낼 수 있다. 빈 배열이면 쿼리를 아예 실행하지 않는다.

### `ChatService.sendMessage` (`modules/chat/service.ts`)

시그니처에 `replyToId?: number`를 추가하고, 내용 검증 다음에 답장 검증을 넣는다:

```
if (replyToId !== undefined) {
  const target = this.messages.findWire(replyToId);
  if (!target || target.c !== conversationId) throw errors.badRequest('INVALID_REPLY');
}
```

같은 대화인지 확인하는 것이 요점이다. 대상이 없거나 다른 대화면 400을 던진다.
자기 자신을 가리키는 경우는 아직 ID가 없으므로 구조적으로 불가능하다.

`payload` 직렬화와 팬아웃 로직은 그대로 — `message`에 `r`이 이미 들어 있다.

### `ChatService.getMessages` → `{ messages, refs? }`

```
const messages = this.messages.list(conversationId, options);
const present = new Set(messages.map((m) => m.id));
const missing = [...new Set(
  messages.map((m) => m.r).filter((id): id is number => id !== undefined && !present.has(id)),
)];
const refs = missing.length ? this.messages.listQuotes(conversationId, missing) : undefined;
```

- `Set`으로 중복을 제거하므로 답장 셋이 같은 원본을 가리켜도 원본은 한 번만 실린다.
- 부족한 것이 없으면 `refs` 필드 자체를 생략해 빈 배열 바이트도 아낀다.
- 반환 타입 변경에 맞춰 `modules/chat/routes.ts`의 `GET /:id/messages` 응답이
  `{ messages, refs? }`가 된다.

### 라우트

- `POST /api/chat/:id/messages` — 본문에 `r` 허용(스키마가 처리), `service.sendMessage`에 전달.
- `ws/routes.ts` — `case 'm'`에서 `chat.sendMessage(userId, frame.c, frame.k, frame.x, ws, frame.r)`.
  실패 시 기존 오류 경로가 `e` 프레임으로 `INVALID_REPLY`를 돌려준다.

### 변경하지 않는 것

`listConversations`(대화 목록), 푸시 알림 미리보기(`modules/push/preview.ts`)는 그대로 둔다.
둘 다 한 줄 미리보기라 인용문이 들어갈 자리가 없다.

## 인용문 표시 규칙 (세 클라이언트 공통)

인용은 **언제나 한 줄 텍스트**다.

| 원본 종류 | 인용 표시 |
| --- | --- |
| `t` 텍스트 | 본문 첫 줄 (넘치면 말줄임) |
| `e` 이모지 | 이모지 그대로 |
| `i` 이미지 | `사진` (`x`는 이미지 ID이므로 표시하지 않는다) |

이미지 인용에 썸네일을 넣지 않는 이유는, 오래된 사진을 인용했을 때 인용문 하나 때문에
새 이미지 요청이 발생하기 때문이다. Lite의 "탭해야 이미지를 받는다"는 원칙과도 맞는다.

**인용 원본 해석 순서** (세 클라이언트 동일):

1. 현재 로드된 메시지 배열에서 `id`로 찾는다 (대부분 여기서 끝난다)
2. 대화별 `refs` 캐시 `Map<number, WireQuote>`에서 찾는다
3. 둘 다 없으면 플레이스홀더(`메시지`)를 표시한다

`refs`는 `/messages` 응답이 올 때마다 캐시에 병합한다. 잘린 본문이므로 **메시지 배열에는
절대 넣지 않는다** — `WireQuote` 타입 분리가 이를 강제한다.

**응답 형태 변경이 닿는 곳**: 세 클라이언트 모두 지금은 `/messages` 응답에서
`messages`만 꺼내 쓴다. `refs`를 받아 캐시에 넣는 경로를 각각 추가해야 한다 —
`apps/web/src/data.ts`(`useMessages`, `loadOlderMessages`),
`apps/app/src/data/data.ts`(동일한 두 곳),
`apps/lite/src/main.ts`(`loadMsgs`와 "이전 메시지 보기" 핸들러).
캐시는 대화별 `Map`이며 채팅방을 벗어나도 유지한다(재진입 시 재요청을 아끼기 위해).

## 원본으로 점프

인용문을 탭하면:

1. 대상이 로드된 배열에 있으면 그 위치로 스크롤한다.
2. 없으면 기존 과거 페이지 로드(`loadOlderMessages` / lite의 "이전 메시지 보기" 경로)를
   대상이 나타날 때까지 반복한다.
3. **최대 10페이지(300개)** 까지만 시도하고, 넘으면 "원본 메시지를 찾을 수 없습니다"
   오류를 표시한다.

`around=` 같은 새 엔드포인트를 만들지 않는 이유: 특정 메시지 주변만 따로 받아오면
클라이언트의 메시지 배열에 구멍이 생겨 페이지네이션·읽음 워터마크 계산이 모두 복잡해진다.
`before=` 반복은 배열의 연속성을 유지하고 기존 코드를 그대로 재사용한다.

상한을 두는 이유는 아주 오래된 메시지를 인용했을 때 저속 회선에서 왕복이 무한정
늘어나는 것을 막기 위해서다.

도착하면 1.2초간 배경을 밝게 플래시해 어느 메시지인지 알린다.

## 클라이언트별 구현

### 공통: 답장 대상 상태와 답장 바

각 채팅방은 "지금 답장 중인 메시지" 상태 하나를 갖는다. 값이 있으면 컴포저 위에
답장 바가 뜬다 — `보낸이 닉네임 · 인용 한 줄 · ✕`. 전송에 성공하면 해제된다.
전송 실패 시에는 유지한다 (입력 복구와 같은 원칙).

### 스와이프 판정 (순수 함수)

방향과 임계값 판정은 제스처 바인딩과 분리한 순수 함수로 둔다:

```ts
/**
 * 스와이프가 답장 제스처로 확정되는지.
 * - 상대 메시지(mine=false)는 오른쪽(+x)으로만, 내 메시지(mine=true)는 왼쪽(-x)으로만
 * - 세로 스크롤과 충돌하지 않도록 가로 이동이 세로보다 뚜렷할 때만 인정
 */
export function replySwipe(dx: number, dy: number, mine: boolean):
  { active: boolean; progress: number };
```

임계값은 56 px, 최대 끌림은 72 px로 둔다 (DESIGN.md의 44 px 터치 타깃보다 크게 잡아
실수로 발동하지 않게 한다).

**이 함수는 `apps/web/src/lib/gesture.ts`와 `apps/app/src/lib/gesture.ts`에 동일한
내용으로 복제한다.** 저장소가 이미 `format.ts`를 두 앱에 바이트 단위로 동일하게 복제하고
있어(확인함) 그 관례를 따르는 것이고, 이 하나 때문에 공유 클라이언트 유틸 패키지를
새로 만드는 것은 이 작업의 범위를 넘는다. 단위 테스트는 jest가 있는 `apps/app` 쪽
사본에 붙는다 — `apps/web`에는 테스트 러너가 없다(package.json에 `test` 스크립트 없음).
두 사본이 어긋날 위험은 "한계"에 적어 둔다.

### web (`apps/web`)

- `MessageBubble`에 `onTouchStart/Move/End` 3개를 직접 단다. `motion`의 `drag`는
  포인터 기반이라 데스크톱에서 텍스트 선택과 충돌하므로 쓰지 않는다.
- 첫 이동에서 `replySwipe()`가 가로 우세로 판정할 때만 스와이프로 확정하고,
  그 전까지는 브라우저의 세로 스크롤을 방해하지 않는다.
- 임계값 통과 시 `navigator.vibrate?.(10)` + 답장 설정.
- 데스크톱: 말풍선 호버 시 `↩` 버튼. `opacity-0 group-hover:opacity-100`에
  `focus-visible:opacity-100`을 함께 걸어 키보드만으로도 도달 가능하게 한다.
- 단축키: **`Ctrl/Cmd + ↑`** 로 마지막 메시지에 답장, `Esc`로 취소.
  단순 `R`을 쓰지 않는 이유는 채팅방에서 입력창이 거의 항상 포커스를 갖고 있어
  글자 입력과 구분되지 않기 때문이다. `Ctrl/Cmd + ↑`는 입력 중에도 안전하게 동작한다.
  **`Esc`는 현재 무조건 목록으로 나가지만, 답장 중일 때는 답장 취소가 우선한다**
  (한 번 더 누르면 목록으로 나간다). `ChatRoom.tsx`의 keydown 핸들러를 수정한다.
- 인용 블록은 말풍선 상단에 얇은 세로선 + 흐린 한 줄로 넣는다.
- 번들 예산 128 KB — 새 라이브러리를 넣지 않으므로 영향은 미미하다.

### app (`apps/app`)

새 의존성 없음 — `react-native-gesture-handler`, `react-native-reanimated`,
`expo-haptics`가 모두 이미 쓰이고 `GestureHandlerRootView`도 `_layout.tsx`에 있다.

- `Gesture.Pan().activeOffsetX([-15, 15]).failOffsetY([-10, 10])`로 FlashList의
  세로 스크롤과 분리한다.
- 기존 길게 눌러 신고(`onLongPress`)와는 `Gesture.Race`로 묶어 하나만 발동하게 한다.
- 임계값에서 `Haptics.impactAsync(ImpactFeedbackStyle.Light)`.
- 말풍선 뒤에 진행도에 따라 나타나는 `↩` 아이콘 (`reanimated` shared value).
- 점프는 `FlashListRef.scrollToIndex`.

### lite (`apps/lite`)

빌드 실측 결과 현재 초기 전송량은 **7283 B / 10240 B (brotli)** 로 약 2.9 KB 여유가 있다.
스와이프를 포함해도 들어간다.

- 메시지 행마다 리스너를 달지 않고 **`.msgs` 컨테이너 하나에 이벤트를 위임**한다
  (`touchstart/touchmove/touchend`). 코드량과 리스너 수 모두 최소화된다.
- 시각 피드백은 `transform: translateX`만 건드린다.
- 데스크톱을 위해 각 메시지 행에 `↩` 문자 버튼을 함께 둔다 (CSS 몇 줄).
- 인용문은 기존 문자 셀 그리드 안에 흐린 한 줄로 넣는다.
- 답장 바는 입력 바 위 한 줄.
- 빌드가 예산을 자동 검사하므로 초과하면 즉시 실패한다.

## 테스트

PROJECT.md의 "서버 기능은 TDD, 웹 기능은 e2e 검증" 규칙을 따른다. 서버 테스트는 구현 전에 쓴다.

### 서버 단위 테스트 (`apps/server/src/modules/chat/chat.test.ts`)

- 답장을 포함해 보내면 `r`이 저장되고 `WireMessage`에 실려 돌아온다
- **다른 대화의 메시지를 인용하면 400 `INVALID_REPLY`** — 본문 유출 차단 경로
- 존재하지 않는 메시지 ID를 인용하면 400
- `getMessages`: 인용 대상이 페이지 안에 있으면 `refs` 필드가 아예 없다
- `getMessages`: 인용 대상이 페이지 밖이면 그것만 `refs`에 담긴다
- 답장 3개가 같은 원본을 가리켜도 `refs` 길이는 1
- `refs`의 본문이 `QUOTE_MAX_CHARS`로 잘린다
- `listQuotes`가 대화 경계를 넘는 ID를 받으면 빈 결과를 준다
- WS `m` 프레임에 `r`을 실어 보내는 경로도 REST와 같은 검증을 받는다

### 프로토콜 테스트 (`apps/server/src/security-controls.test.ts`)

기존 `client WebSocket frames are strict and size bounded` 테스트를 확장한다
(`packages/types`에는 테스트 러너가 없어 프레임 파싱 검증이 여기에 산다).

- `r`이 붙은 클라이언트 프레임이 파싱된다
- `r`이 0/음수/소수/문자열이면 거부된다

### 앱 단위 테스트 (`apps/app`, jest)

- `replySwipe()` — 방향 제한(상대는 오른쪽만, 내 것은 왼쪽만), 임계값, 세로 우세 시 미발동
- `message-bubble.test.tsx` — 인용문 렌더(텍스트/이모지/이미지 `사진`/플레이스홀더)

### e2e (`e2e/tests/web.spec.ts`, `lite.spec.ts`)

한 흐름으로 검증한다: 답장 전송 → 상대 화면에 인용문이 보임 → 인용문 클릭 시 원본으로
스크롤. 스와이프 자체는 Playwright의 터치 에뮬레이션이 불안정하므로, 답장 진입은
데스크톱 경로(`↩` 버튼)로 하고 스와이프 판정은 위의 순수 함수 단위 테스트로 덮는다.

## 구현 순서

1. 공유 타입 · 프로토콜 · 스키마 (`packages/types`)
2. 마이그레이션 + `MessagesRepo` + `ChatService` + 라우트 (테스트 우선)
3. `apps/web`
4. `apps/app`
5. `apps/lite`
6. e2e

1–2가 끝나면 3, 4, 5는 서로 독립적이다.

## 한계

- 답장 대상이 아주 오래된 메시지면 점프에 여러 왕복이 필요하고, 300개를 넘어가면
  포기한다. 저속 회선 보호를 위한 의도적 절충이다.
- 인용문은 1단계만 표시한다. 답장에 답장한 경우 인용문 안에 또 인용문을 그리지 않는다.
- 인용 미리보기는 100자로 잘린다. 화면에서 어차피 한 줄로 표시되므로 실제 손실은 없다.
- 스와이프 판정 규칙의 사본이 **셋**이다 — `apps/web/src/lib/gesture.ts`,
  `apps/app/src/lib/gesture.ts`, 그리고 `apps/lite/src/main.ts`의 인라인 버전.
  Lite가 별도 사본을 갖는 이유는 `@litechat/types`에서 런타임 값을 import하면
  `index.ts`가 재수출하는 `schemas.ts`를 통해 zod가 번들에 딸려올 수 있고,
  10 KB 예산에서 그 위험을 감수할 수 없기 때문이다. 임계값(56/72)을 바꿀 때는
  세 곳을 함께 고쳐야 하며, 자동 검증은 `apps/app` 사본에만 붙는다.
- web의 스와이프 제스처 자체에는 자동 테스트가 없다. Playwright의 터치 에뮬레이션이
  불안정해 e2e는 데스크톱 `↩` 버튼 경로로 검증하고, 판정 로직만 순수 함수 테스트로
  덮는다. 실제 web 스와이프는 수동 확인이 필요하다.
