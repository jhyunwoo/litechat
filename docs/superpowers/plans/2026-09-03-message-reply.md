# 메시지 답장(reply) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상대/내 메시지에 답장을 달 수 있게 한다. 모바일은 스와이프(상대 →, 내 것 ←), 데스크톱은 호버 버튼과 `Ctrl/Cmd+↑`로 답장하고, 인용문을 누르면 원본으로 이동한다.

**Architecture:** 메시지에 `r`(답장 대상 ID) 한 필드만 추가한다. 인용문을 그리는 데 필요한데 이번 페이지에 없는 원본은 서버가 `GET /messages` 응답의 `refs`에 한 번씩만 담아 보낸다. 클라이언트는 ① 로드된 메시지 → ② `refs` 캐시 → ③ 플레이스홀더 순으로 인용 원본을 해석한다.

**Tech Stack:** Bun + Hono + SQLite(bun:sqlite) / React 19 + TanStack Query + motion / Expo 57 + react-native-gesture-handler + reanimated / 프레임워크 없는 TypeScript(esbuild)

**Spec:** `docs/superpowers/specs/2026-09-03-message-reply-design.md`

## Global Constraints

- 와이어 포맷의 모든 키는 **한 글자**다. 답장 대상은 `r`, 인용 묶음은 `refs`.
- `r`은 **옵셔널**이어야 한다 — 답장이 아닌 메시지의 전송량이 1바이트도 늘면 안 된다.
- 인용 본문 상한 `QUOTE_MAX_CHARS = 100`. 서버에서만 자르고 클라이언트로는 상수를 내보내지 않는다.
- `listQuotes`는 **반드시** `conversation_id`로 범위를 제한한다. 이것이 다른 대화 본문 유출을 막는 유일한 방어선이다.
- 인용문은 언제나 한 줄 텍스트다. 이미지 원본은 `사진`, 이모지는 이모지 그대로. **인용 때문에 이미지 요청이 발생하면 안 된다.**
- 점프 시 과거 페이지 로드는 **최대 10페이지**까지만 시도한다.
- 스와이프 임계값 `56`px, 최대 끌림 `72`px.
- Lite 초기 전송량 예산 **10240 B (brotli)**. 착수 시점 기준선은 **7283 B**. 빌드가 자동 검사한다.
- Full Chat 예산 128 KB, 대시보드 78 KB — 새 런타임 의존성을 추가하지 않는다.
- 마이그레이션은 **v9 → v10** 한 건. 기존 마이그레이션은 절대 수정하지 않는다.
- `apps/app` 작업 전에는 `apps/app/AGENTS.md` 지시에 따라 https://docs.expo.dev/versions/v57.0.0/ 의 해당 API 문서를 먼저 확인한다.
- 모든 새 코드에 한국어 주석을 단다 (PROJECT.md 규칙).

---

### Task 1: 공유 타입 · 프로토콜 · 스키마

**Files:**
- Modify: `packages/types/src/entities.ts`
- Modify: `packages/types/src/schemas.ts:88-96` (`sendMessageSchema`)
- Modify: `packages/types/src/protocol.ts:37-52` (`ClientSendFrame`), `:64-78` (`clientFrameSchema`)
- Test: `apps/server/src/security-controls.test.ts:22` (`client WebSocket frames are strict and size bounded`)

**Interfaces:**
- Produces: `WireMessage.r?: number`, `WireQuote { id, s, k, x }`, `ClientSendFrame.r?: number`, `sendMessageSchema` 에 `r`.
  `packages/types/src/index.ts`는 `export * from './entities'` 이므로 `WireQuote`는 자동으로 공개된다.

- [ ] **Step 1: 프레임 파싱 실패 테스트를 먼저 추가**

`apps/server/src/security-controls.test.ts`의 기존 테스트 본문 끝에 이어 붙인다:

```ts
    // 답장: r은 양의 정수만 허용한다.
    expect(parseClientFrame('{"t":"m","c":1,"k":"t","x":"hi","i":"tmp","r":5}')).toEqual({
      t: 'm',
      c: 1,
      k: 't',
      x: 'hi',
      i: 'tmp',
      r: 5,
    });
    expect(parseClientFrame('{"t":"m","c":1,"k":"t","x":"hi","i":"tmp","r":0}')).toBeNull();
    expect(parseClientFrame('{"t":"m","c":1,"k":"t","x":"hi","i":"tmp","r":-1}')).toBeNull();
    expect(parseClientFrame('{"t":"m","c":1,"k":"t","x":"hi","i":"tmp","r":1.5}')).toBeNull();
    expect(parseClientFrame('{"t":"m","c":1,"k":"t","x":"hi","i":"tmp","r":"5"}')).toBeNull();
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인**

Run: `cd apps/server && bun test src/security-controls.test.ts -t "client WebSocket frames"`
Expected: FAIL — `r:5`를 실은 프레임이 `.strict()` 때문에 `null`로 거부된다.

- [ ] **Step 3: `entities.ts`에 `r`과 `WireQuote` 추가**

`WireMessage`의 `im?` 필드 바로 뒤에 추가:

```ts
  /** 답장 대상 메시지 ID — 항상 같은 대화 안의 메시지를 가리킨다 (답장이 아니면 없음) */
  r?: number;
}

/**
 * 인용 표시 전용 축약 메시지.
 *
 * 본문(x)은 서버가 100자로 잘라 보내므로 **메시지 목록에 병합하면 안 된다**.
 * WireMessage와 타입을 분리해 그 사고를 컴파일 타임에 막는다.
 * 닉네임은 싣지 않는다 — 1:1 대화라 s는 나 아니면 상대이고,
 * 클라이언트가 이미 me와 conversation.peer를 갖고 있어 로컬에서 붙일 수 있다.
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
```

- [ ] **Step 4: `schemas.ts`의 `sendMessageSchema`에 `r` 추가**

```ts
export const sendMessageSchema = z.object({
  /** 메시지 종류: t(텍스트) / i(이미지 ID) / e(이모지) */
  k: z.enum(['t', 'i', 'e']),
  /** 내용 — 텍스트/이모지 본문 또는 업로드된 이미지 ID */
  x: z.string().min(1).max(MAX_MESSAGE_LENGTH),
  /** 답장 대상 메시지 ID (선택) — 같은 대화의 메시지여야 한다 */
  r: z.number().int().positive().optional(),
});
```

- [ ] **Step 5: `protocol.ts`의 클라이언트 전송 프레임에 `r` 추가**

`ClientSendFrame` 인터페이스의 `i` 필드 뒤:

```ts
  /** 답장 대상 메시지 ID (선택) */
  r?: number;
```

`clientFrameSchema`의 `'m'` 분기 객체에 (`.strict()` 앞) 한 줄 추가:

```ts
      r: z.number().int().positive().optional(),
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `cd apps/server && bun test src/security-controls.test.ts -t "client WebSocket frames"`
Expected: PASS

- [ ] **Step 7: 타입 검사**

Run: `cd /home/coder/projects/litechat && bun run check-types`
Expected: 오류 없음

- [ ] **Step 8: 커밋**

```bash
git add packages/types/src apps/server/src/security-controls.test.ts
git commit -m "feat(types): 메시지 답장 대상 r 필드와 WireQuote 타입 추가"
```

---

### Task 2: DB 마이그레이션 + MessagesRepo

**Files:**
- Modify: `apps/server/src/db/migrations.ts` (배열 끝에 v9 → v10 항목 추가)
- Modify: `apps/server/src/modules/chat/messages-repo.ts`
- Test: `apps/server/src/modules/chat/chat.test.ts` (새 `describe` 블록)

**Interfaces:**
- Consumes: Task 1의 `WireMessage.r`, `WireQuote`
- Produces:
  - `MessagesRepo.insert(conversationId, senderId, kind, content, replyToId?): WireMessage`
  - `MessagesRepo.listQuotes(conversationId: number, ids: number[]): WireQuote[]`
  - `toWire()`가 `reply_to_id`를 `r`로 옮긴다

- [ ] **Step 1: 실패하는 repo 테스트 작성**

`apps/server/src/modules/chat/chat.test.ts` 맨 위 import에 추가:

```ts
import { MessagesRepo } from './messages-repo';
```

파일 끝에 새 describe 추가:

```ts
describe('MessagesRepo — 답장', () => {
  test('replyToId를 저장하고 WireMessage에 r로 되돌려준다', () => {
    const repo = new MessagesRepo(deps.db);
    const target = repo.insert(conversationId, alice.user.id, 't', '원본');
    const reply = repo.insert(conversationId, bob.user.id, 't', '답장', target.id);

    expect(target.r).toBeUndefined();
    expect(reply.r).toBe(target.id);
    expect(repo.findWire(reply.id)!.r).toBe(target.id);
  });

  test('listQuotes는 본문을 100자로 자른다', () => {
    const repo = new MessagesRepo(deps.db);
    const long = 'ㄱ'.repeat(150);
    const target = repo.insert(conversationId, alice.user.id, 't', long);

    const [quote] = repo.listQuotes(conversationId, [target.id]);
    expect(quote).toEqual({ id: target.id, s: alice.user.id, k: 't', x: 'ㄱ'.repeat(100) });
  });

  // 보안 경계: 대화 ID를 조건에서 빼면 남의 대화 본문을 ID만으로 긁을 수 있다.
  test('listQuotes는 다른 대화의 메시지를 절대 반환하지 않는다', async () => {
    const carol = await signup(app, 'carol', 'Carol');
    const other = await jsonRequest(app, '/api/friends/requests', {
      method: 'POST',
      cookie: alice.cookie,
      body: { userId: carol.user.id },
    });
    const { id: friendshipId } = (await other.json()) as { id: number };
    const accepted = await jsonRequest(app, `/api/friends/requests/${friendshipId}/respond`, {
      method: 'POST',
      cookie: carol.cookie,
      body: { accept: true },
    });
    const otherConv = ((await accepted.json()) as { conversationId: number }).conversationId;

    const repo = new MessagesRepo(deps.db);
    const secret = repo.insert(otherConv, alice.user.id, 't', '비밀 이야기');

    expect(repo.listQuotes(conversationId, [secret.id])).toEqual([]);
  });

  test('listQuotes는 빈 배열을 받으면 빈 배열을 준다', () => {
    expect(new MessagesRepo(deps.db).listQuotes(conversationId, [])).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/server && bun test src/modules/chat/chat.test.ts -t "MessagesRepo"`
Expected: FAIL — `listQuotes is not a function`, `insert`가 5번째 인자를 무시

- [ ] **Step 3: 마이그레이션 추가**

`apps/server/src/db/migrations.ts`의 `MIGRATIONS` 배열 **맨 끝**에 추가 (기존 항목은 건드리지 않는다):

```ts
  // v9 → v10: 답장 — 메시지가 같은 대화 안의 다른 메시지를 인용한다.
  // 인덱스를 만들지 않는 이유: 조회는 항상 PK(m.id IN (...))로만 일어나고
  // "이 메시지에 달린 답장 전부" 같은 역방향 질의가 없다. 실측 근거 없는 인덱스는
  // 쓰기 비용만 늘린다.
  // 매달린 참조가 생기지 않는 이유: 계정 삭제는 대화의 메시지를 통째로 지우고,
  // 인용은 언제나 같은 대화 안이므로 대상만 남거나 사라지지 않는다.
  `
  ALTER TABLE messages ADD COLUMN reply_to_id INTEGER REFERENCES messages(id);
  `,
```

- [ ] **Step 4: `messages-repo.ts` 수정**

`import type` 줄에 `WireQuote`를 추가한다:

```ts
import type { MessageKind, WireMessage, WireQuote } from '@litechat/types';
```

`MessageJoinRow`에 필드 추가:

```ts
  reply_to_id: number | null;
```

`SELECT_WITH_IMAGE`의 첫 SELECT 줄을 교체:

```ts
  SELECT m.id, m.conversation_id, m.sender_id, m.kind, m.content, m.created_at, m.reply_to_id,
```

`toWire()`의 `if (row.kind === 'i' ...)` 블록 **앞**에 추가:

```ts
  if (row.reply_to_id !== null) wire.r = row.reply_to_id;
```

파일 상단(`SELECT_WITH_IMAGE` 정의 뒤)에 상수 추가:

```ts
/**
 * 인용 미리보기 본문 최대 길이 (문자).
 * 클라이언트는 인용문을 한 줄로만 표시하므로 이보다 길 필요가 없다.
 * service.ts의 PREVIEW_MAX_CHARS와 같은 이유로 서버 안에 둔다 — 클라이언트가
 * 쓰지 않는 상수를 공유 패키지에 두면 세 번들에 그대로 딸려 들어간다.
 */
const QUOTE_MAX_CHARS = 100;
```

`insert`를 교체:

```ts
  /** 메시지 저장 후 와이어 포맷으로 반환. replyToId가 있으면 답장으로 기록한다. */
  insert(
    conversationId: number,
    senderId: number,
    kind: MessageKind,
    content: string,
    replyToId?: number,
  ): WireMessage {
    const ts = Math.floor(Date.now() / 1000);
    const result = this.db
      .query(
        `INSERT INTO messages (conversation_id, sender_id, kind, content, created_at, reply_to_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(conversationId, senderId, kind, content, ts, replyToId ?? null);
    const id = Number(result.lastInsertRowid);
    return this.findWire(id)!;
  }
```

`findWire` 뒤에 `listQuotes` 추가:

```ts
  /**
   * 인용 표시용 축약 조회 — 답장이 가리키는 원본을 한 줄 미리보기로만 가져온다.
   *
   * conversation_id 조건이 보안 경계다. 이게 없으면 남의 대화 메시지 ID를 찍어
   * 본문 앞 100자를 긁어낼 수 있다. 절대 빼지 말 것.
   */
  listQuotes(conversationId: number, ids: number[]): WireQuote[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return this.db
      .query<{ id: number; sender_id: number; kind: MessageKind; content: string }, number[]>(
        `SELECT m.id, m.sender_id, m.kind, substr(m.content, 1, ?) AS content
         FROM messages m
         WHERE m.conversation_id = ? AND m.id IN (${placeholders})`,
      )
      .all(QUOTE_MAX_CHARS, conversationId, ...ids)
      .map((row) => ({ id: row.id, s: row.sender_id, k: row.kind, x: row.content }));
  }
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd apps/server && bun test src/modules/chat/chat.test.ts`
Expected: PASS (기존 테스트 포함 전부)

- [ ] **Step 6: 마이그레이션이 기존 DB에서도 도는지 확인**

Run: `cd apps/server && bun test src/db/database.test.ts`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add apps/server/src/db/migrations.ts apps/server/src/modules/chat/messages-repo.ts apps/server/src/modules/chat/chat.test.ts
git commit -m "feat(server): messages.reply_to_id 추가와 인용 축약 조회"
```

---

### Task 3: 답장 전송 검증 (service + REST + WS)

**Files:**
- Modify: `apps/server/src/modules/chat/service.ts:59-97` (`sendMessage`)
- Modify: `apps/server/src/modules/chat/routes.ts:37-48` (POST 라우트)
- Modify: `apps/server/src/ws/routes.ts:37-49` (`case 'm'`)
- Test: `apps/server/src/modules/chat/chat.test.ts`

**Interfaces:**
- Consumes: Task 2의 `MessagesRepo.insert(..., replyToId?)`
- Produces: `ChatService.sendMessage(meId, conversationId, kind, content, excludeSocket?, replyToId?)`
  — `replyToId`가 **여섯 번째** 인자다 (`excludeSocket` 뒤). 기존 호출부는 그대로 동작한다.

- [ ] **Step 1: 실패 테스트 작성**

`chat.test.ts`의 `describe('POST /api/chat/:id/messages')` 안에 추가:

```ts
  test('답장을 보내면 r이 저장되고 상대 프레임에도 실린다', async () => {
    const target = await sendMessage(alice, '원본 메시지');
    const bobSocket = fakeSocket(deps, bob.user.id);

    const res = await jsonRequest(app, `/api/chat/${conversationId}/messages`, {
      method: 'POST',
      cookie: bob.cookie,
      body: { k: 't', x: '답장이야', r: target.id },
    });
    expect(res.status).toBe(201);
    const { message } = (await res.json()) as { message: { r?: number } };
    expect(message.r).toBe(target.id);
    expect(bobSocket.frames).toContainEqual(
      expect.objectContaining({ t: 'm', x: '답장이야', r: target.id }),
    );
  });

  test('존재하지 않는 메시지를 인용하면 400', async () => {
    const res = await jsonRequest(app, `/api/chat/${conversationId}/messages`, {
      method: 'POST',
      cookie: alice.cookie,
      body: { k: 't', x: '유령 답장', r: 999_999 },
    });
    expect(res.status).toBe(400);
  });

  // 다른 대화의 메시지를 인용하면 그 본문이 refs로 흘러나온다 — 반드시 막아야 한다.
  test('다른 대화의 메시지를 인용하면 400', async () => {
    const carol = await signup(app, 'carol2', 'Carol');
    const requested = await jsonRequest(app, '/api/friends/requests', {
      method: 'POST',
      cookie: alice.cookie,
      body: { userId: carol.user.id },
    });
    const { id: friendshipId } = (await requested.json()) as { id: number };
    const accepted = await jsonRequest(app, `/api/friends/requests/${friendshipId}/respond`, {
      method: 'POST',
      cookie: carol.cookie,
      body: { accept: true },
    });
    const otherConv = ((await accepted.json()) as { conversationId: number }).conversationId;
    const secret = await sendMessage(alice, '비밀', otherConv);

    const res = await jsonRequest(app, `/api/chat/${conversationId}/messages`, {
      method: 'POST',
      cookie: alice.cookie,
      body: { k: 't', x: '몰래 인용', r: secret.id },
    });
    expect(res.status).toBe(400);
  });
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/server && bun test src/modules/chat/chat.test.ts -t "답장"`
Expected: FAIL — `r`이 응답에 없고, 잘못된 인용이 201로 통과한다

- [ ] **Step 3: `service.ts`의 `sendMessage` 수정**

시그니처에 인자 추가:

```ts
  sendMessage(
    meId: number,
    conversationId: number,
    kind: MessageKind,
    content: string,
    /** WS 전송 시 본인 소켓 (팬아웃에서 제외하고 ack만 받게 한다) */
    excludeSocket?: WSContext,
    /** 답장 대상 메시지 ID (선택) */
    replyToId?: number,
  ): WireMessage {
```

이미지 검증 블록(`if (kind === 'i') { ... }`) **바로 뒤**에 추가:

```ts
    // 답장 대상은 반드시 같은 대화 안의 메시지여야 한다.
    // 다른 대화의 ID를 인용하면 그 본문이 refs를 타고 새어 나가므로 여기서 막는다.
    if (replyToId !== undefined) {
      const target = this.messages.findWire(replyToId);
      if (!target || target.c !== conversationId) throw errors.badRequest('INVALID_REPLY');
    }
```

`insert` 호출을 교체:

```ts
    const message = this.messages.insert(conversationId, meId, kind, trimmed, replyToId);
```

- [ ] **Step 4: REST 라우트 배선**

`apps/server/src/modules/chat/routes.ts`의 POST 핸들러 본문을 교체:

```ts
          const { id } = c.req.valid('param');
          const { k, x, r } = c.req.valid('json');
          const message = service.sendMessage(c.var.userId, id, k, x, undefined, r);
          return c.json({ message }, 201);
```

- [ ] **Step 5: WS 라우트 배선**

`apps/server/src/ws/routes.ts`의 `case 'm'` 첫 줄을 교체:

```ts
                const message = chat.sendMessage(userId, frame.c, frame.k, frame.x, ws, frame.r);
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `cd apps/server && bun test`
Expected: PASS (서버 전체)

- [ ] **Step 7: 커밋**

```bash
git add apps/server/src/modules/chat apps/server/src/ws/routes.ts
git commit -m "feat(server): 답장 전송 검증 — 같은 대화의 메시지만 인용 가능"
```

---

### Task 4: `GET /messages` 응답에 `refs` 동봉

**Files:**
- Modify: `apps/server/src/modules/chat/service.ts:100-108` (`getMessages`)
- Modify: `apps/server/src/modules/chat/routes.ts:27-36` (GET 라우트)
- Test: `apps/server/src/modules/chat/chat.test.ts`

**Interfaces:**
- Consumes: Task 2의 `MessagesRepo.listQuotes`
- Produces: `ChatService.getMessages(...): { messages: WireMessage[]; refs?: WireQuote[] }`
  — 유일한 호출부는 `routes.ts:33`이다 (확인함).

- [ ] **Step 1: 실패 테스트 작성**

`chat.test.ts`에 새 describe 추가:

```ts
describe('GET /api/chat/:id/messages — refs', () => {
  /** 메시지 목록을 { messages, refs } 형태로 받는다 */
  async function fetchMessages(query: string) {
    const res = await jsonRequest(app, `/api/chat/${conversationId}/messages${query}`, {
      cookie: alice.cookie,
    });
    expect(res.status).toBe(200);
    return (await res.json()) as {
      messages: { id: number; r?: number }[];
      refs?: { id: number; x: string }[];
    };
  }

  test('인용 대상이 같은 페이지에 있으면 refs 필드가 아예 없다', async () => {
    const target = await sendMessage(alice, '원본');
    await jsonRequest(app, `/api/chat/${conversationId}/messages`, {
      method: 'POST',
      cookie: bob.cookie,
      body: { k: 't', x: '답장', r: target.id },
    });

    const body = await fetchMessages('?limit=30');
    expect(body.messages).toHaveLength(2);
    expect(body.refs).toBeUndefined();
  });

  test('인용 대상이 페이지 밖이면 그것만 refs에 담긴다', async () => {
    const target = await sendMessage(alice, '아주 오래된 원본');
    await sendMessage(alice, '사이 메시지');
    await jsonRequest(app, `/api/chat/${conversationId}/messages`, {
      method: 'POST',
      cookie: bob.cookie,
      body: { k: 't', x: '답장', r: target.id },
    });

    // 마지막 1개만 받으면 원본은 페이지 밖이다.
    const body = await fetchMessages('?limit=1');
    expect(body.messages).toHaveLength(1);
    expect(body.refs).toEqual([
      expect.objectContaining({ id: target.id, x: '아주 오래된 원본' }),
    ]);
  });

  test('답장 셋이 같은 원본을 가리켜도 refs는 하나만 싣는다', async () => {
    const target = await sendMessage(alice, '인기 있는 원본');
    for (const text of ['답장1', '답장2', '답장3']) {
      await jsonRequest(app, `/api/chat/${conversationId}/messages`, {
        method: 'POST',
        cookie: bob.cookie,
        body: { k: 't', x: text, r: target.id },
      });
    }

    const body = await fetchMessages('?limit=3');
    expect(body.messages).toHaveLength(3);
    expect(body.refs).toHaveLength(1);
    expect(body.refs![0]!.id).toBe(target.id);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/server && bun test src/modules/chat/chat.test.ts -t "refs"`
Expected: FAIL — `body.refs`가 항상 `undefined`

- [ ] **Step 3: `service.ts`의 `getMessages` 교체**

파일 상단 import에 `WireQuote`를 추가한다:

```ts
import type {
  ConversationSummary,
  MessageKind,
  PublicUser,
  WireMessage,
  WireQuote,
} from '@litechat/types';
```

메서드를 교체:

```ts
  /**
   * 메시지 목록 조회.
   *
   * 답장이 가리키는 원본 중 이번 페이지에 없는 것만 refs에 실어 보낸다.
   * 클라이언트가 인용문을 그리려고 따로 요청하지 않아도 되고, 답장 여러 개가
   * 같은 원본을 가리켜도 원본은 한 번만 전송된다.
   * 부족한 것이 없으면 refs 필드 자체를 생략해 빈 배열 바이트도 아낀다.
   */
  getMessages(
    meId: number,
    conversationId: number,
    options: { after?: number; before?: number; limit: number },
  ): { messages: WireMessage[]; refs?: WireQuote[] } {
    this.requireMembership(meId, conversationId);
    const messages = this.messages.list(conversationId, options);

    const present = new Set(messages.map((message) => message.id));
    const missing = new Set<number>();
    for (const message of messages) {
      if (message.r !== undefined && !present.has(message.r)) missing.add(message.r);
    }
    if (missing.size === 0) return { messages };
    return { messages, refs: this.messages.listQuotes(conversationId, [...missing]) };
  }
```

- [ ] **Step 4: GET 라우트를 새 반환값에 맞춘다**

`routes.ts`의 GET 핸들러 본문을 교체:

```ts
          const { id } = c.req.valid('param');
          return c.json(service.getMessages(c.var.userId, id, c.req.valid('query')), 200);
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd apps/server && bun test`
Expected: PASS

- [ ] **Step 6: 타입 검사**

Run: `cd /home/coder/projects/litechat && bun run check-types`
Expected: 오류 없음

- [ ] **Step 7: 커밋**

```bash
git add apps/server/src/modules/chat
git commit -m "feat(server): 메시지 응답에 페이지 밖 인용 원본(refs) 동봉"
```

---

### Task 5: 스와이프 판정 순수 함수

**Files:**
- Create: `apps/app/src/lib/gesture.ts`
- Create: `apps/web/src/lib/gesture.ts` (위 파일과 **동일 내용**)
- Test: `apps/app/src/lib/__tests__/gesture.test.ts`

**Interfaces:**
- Produces: `REPLY_SWIPE_THRESHOLD = 56`, `REPLY_SWIPE_MAX = 72`,
  `replySwipe(dx: number, dy: number, mine: boolean): { offset: number; ready: boolean }`
  — `offset`은 **부호가 있는** 화면 이동량(내 메시지는 음수), `ready`는 임계값 통과 여부.

**Note:** `apps/web`에는 테스트 러너가 없다(package.json에 `test` 스크립트 없음). 저장소가 이미 `format.ts`를 web/app에 바이트 단위로 동일하게 복제하고 있으므로 그 관례를 따르고, 테스트는 jest가 있는 app 사본에 붙인다. Lite는 zod를 번들에 끌어들이지 않기 위해 Task 9에서 같은 규칙을 인라인으로 다시 쓴다.

- [ ] **Step 1: 실패 테스트 작성**

`apps/app/src/lib/__tests__/gesture.test.ts`:

```ts
/**
 * 답장 스와이프 판정 테스트 — 방향 제한, 임계값, 세로 스크롤 회피
 */
import { REPLY_SWIPE_MAX, REPLY_SWIPE_THRESHOLD, replySwipe } from '../gesture';

describe('replySwipe', () => {
  test('상대 메시지는 왼쪽→오른쪽으로 끌리면 답장이 된다', () => {
    expect(replySwipe(60, 0, false)).toEqual({ offset: 60, ready: true });
  });

  test('내 메시지는 오른쪽→왼쪽으로 끌리면 답장이 된다', () => {
    expect(replySwipe(-60, 0, true)).toEqual({ offset: -60, ready: true });
  });

  test('상대 메시지를 왼쪽으로 끌면 반응하지 않는다', () => {
    expect(replySwipe(-60, 0, false)).toEqual({ offset: 0, ready: false });
  });

  test('내 메시지를 오른쪽으로 끌면 반응하지 않는다', () => {
    expect(replySwipe(60, 0, true)).toEqual({ offset: 0, ready: false });
  });

  test('임계값 미만이면 따라오기만 하고 답장은 아니다', () => {
    const { offset, ready } = replySwipe(REPLY_SWIPE_THRESHOLD - 1, 0, false);
    expect(offset).toBe(REPLY_SWIPE_THRESHOLD - 1);
    expect(ready).toBe(false);
  });

  test('세로 이동이 크면 스크롤로 보고 무시한다', () => {
    expect(replySwipe(60, 50, false)).toEqual({ offset: 0, ready: false });
  });

  test('최대 끌림을 넘지 않는다', () => {
    expect(replySwipe(500, 0, false)).toEqual({ offset: REPLY_SWIPE_MAX, ready: true });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd apps/app && bun run test -- gesture`
Expected: FAIL — `Cannot find module '../gesture'`

- [ ] **Step 3: `apps/app/src/lib/gesture.ts` 작성**

```ts
/**
 * 답장 스와이프 판정 — 제스처 바인딩(터치 이벤트 / Pan 제스처)과 분리한 순수 함수.
 *
 * 웹과 앱이 같은 감도를 갖도록 규칙을 한곳에 모았다.
 * apps/web/src/lib/gesture.ts에 동일한 사본이 있다 (저장소의 format.ts와 같은 관례).
 * 규칙을 고칠 때는 두 파일을 함께 고칠 것.
 */

/** 이만큼 끌면 답장으로 확정된다 (px) */
export const REPLY_SWIPE_THRESHOLD = 56;
/** 아무리 끌어도 이 이상 밀리지 않는다 (px) */
export const REPLY_SWIPE_MAX = 72;

/**
 * 스와이프 진행 상태를 계산한다.
 *
 * - 상대 메시지(mine=false)는 왼쪽→오른쪽(+x)으로만, 내 메시지(mine=true)는
 *   오른쪽→왼쪽(-x)으로만 끌린다. 반대 방향은 무시한다.
 * - 가로 이동이 세로보다 뚜렷할 때만 인정한다. 그러지 않으면 목록 세로 스크롤과
 *   다투게 된다.
 *
 * @returns offset 화면에 적용할 부호 있는 이동량(내 메시지는 음수), ready 답장 확정 여부
 */
export function replySwipe(
  dx: number,
  dy: number,
  mine: boolean,
): { offset: number; ready: boolean } {
  // 허용 방향으로의 이동량 (반대 방향이면 음수가 되어 아래에서 걸러진다)
  const along = mine ? -dx : dx;
  if (along <= 0) return { offset: 0, ready: false };
  if (along <= Math.abs(dy) * 1.5) return { offset: 0, ready: false };

  const distance = Math.min(along, REPLY_SWIPE_MAX);
  return { offset: mine ? -distance : distance, ready: along >= REPLY_SWIPE_THRESHOLD };
}
```

- [ ] **Step 4: web 사본 생성**

`apps/app/src/lib/gesture.ts`를 `apps/web/src/lib/gesture.ts`로 그대로 복사하고, 주석의 상대 경로만 `apps/app/src/lib/gesture.ts`로 바꾼다.

```bash
cp apps/app/src/lib/gesture.ts apps/web/src/lib/gesture.ts
```
복사 후 파일 안의 `apps/web/src/lib/gesture.ts에 동일한 사본이 있다` 문구를 `apps/app/src/lib/gesture.ts에 동일한 사본이 있다`로 수정한다.

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd apps/app && bun run test -- gesture`
Expected: PASS (7개)

- [ ] **Step 6: 커밋**

```bash
git add apps/app/src/lib/gesture.ts apps/app/src/lib/__tests__/gesture.test.ts apps/web/src/lib/gesture.ts
git commit -m "feat(client): 답장 스와이프 판정 순수 함수와 테스트"
```

---

### Task 6: web 데이터 계층 — refs 캐시와 답장 전송

**Files:**
- Modify: `apps/web/src/data.ts`
- Modify: `apps/web/src/lib/format.ts`

**Interfaces:**
- Consumes: Task 4의 `{ messages, refs? }` 응답 형태
- Produces:
  - `quoteText(k: MessageKind, x: string): string` (`lib/format.ts`)
  - `cacheQuotes(convId: number, refs: WireQuote[] | undefined): void`
  - `getQuote(convId: number, id: number): WireQuote | undefined`
  - `sendMessage(queryClient, meId, convId, kind, content, replyTo?)` — `replyTo`가 **여섯 번째** 인자

- [ ] **Step 1: `lib/format.ts`에 인용 본문 헬퍼 추가**

`apps/web/src/lib/format.ts` 끝에 추가:

```ts
/**
 * 인용문에 표시할 한 줄 텍스트.
 * 이미지는 본문이 이미지 ID이므로 '사진'으로 바꾼다 — 인용 때문에 이미지를
 * 새로 내려받는 일이 없어야 한다.
 */
export function quoteText(kind: MessageKind, content: string): string {
  return kind === 'i' ? '사진' : content;
}
```

파일 상단 import에 타입을 추가한다 (없다면):

```ts
import type { MessageKind } from '@litechat/types';
```

- [ ] **Step 2: `data.ts`에 refs 캐시 추가**

import 줄에 `WireQuote`를 추가:

```ts
import type {
  ConversationSummary,
  MessageKind,
  ServerFrame,
  WireMessage,
  WireQuote,
} from '@litechat/types';
```

`PAGE_SIZE` 선언 아래에 추가:

```ts
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
```

- [ ] **Step 3: 세 곳의 `/messages` 응답 처리에서 refs를 캐시에 넣는다**

`useMessages`의 `queryFn`:

```ts
    queryFn: async () => {
      const res = await api.api.chat[':id'].messages.$get({
        param: { id: String(convId) },
        query: { limit: String(PAGE_SIZE) },
      });
      const { messages, refs } = await unwrap<{ messages: WireMessage[]; refs?: WireQuote[] }>(res);
      cacheQuotes(convId, refs);
      return messages;
    },
```

`catchUpMessages` 안:

```ts
        const { messages, refs } = await unwrap<{
          messages: WireMessage[];
          refs?: WireQuote[];
        }>(res);
        cacheQuotes(convId, refs);
        if (messages.length === 0) return;
```

`loadOlderMessages` 안:

```ts
      const { messages, refs } = await unwrap<{ messages: WireMessage[]; refs?: WireQuote[] }>(res);
      cacheQuotes(convId, refs);
      if (messages.length === 0) return false;
```

- [ ] **Step 4: `sendMessage`에 답장 대상 전달**

```ts
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
```

- [ ] **Step 5: 타입 검사**

Run: `cd /home/coder/projects/litechat && bun run check-types`
Expected: 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/data.ts apps/web/src/lib/format.ts
git commit -m "feat(web): 인용 원본 캐시와 답장 전송 배선"
```

---

### Task 7: web UI — 인용문·답장 바·스와이프·단축키·점프

**Files:**
- Modify: `apps/web/src/components/MessageBubble.tsx`
- Modify: `apps/web/src/pages/ChatRoom.tsx`

**Interfaces:**
- Consumes: Task 5 `replySwipe`, Task 6 `getQuote`/`quoteText`/`sendMessage(..., replyTo)`
- Produces: `QuoteView { id: number; name: string; text: string }` (`MessageBubble.tsx`에서 export)

- [ ] **Step 1: `MessageBubble.tsx` 교체**

```tsx
/**
 * 메시지 말풍선 — iMessage 스타일 스프링 등장 애니메이션
 *
 * - 내 메시지: 파란 말풍선, 오른쪽 정렬
 * - 상대 메시지: 회색 말풍선, 왼쪽 정렬
 * - 이모지 전용 메시지: 말풍선 없이 크게 표시
 * - 이미지: 저화질 webp 표시, 탭하면 뷰어 열기
 * - 답장: 말풍선 위에 인용 한 줄, 모바일은 스와이프 / 데스크톱은 호버 ↩ 버튼
 */
import type { WireMessage } from '@litechat/types';
import { m } from 'motion/react';
import { memo, useRef, useState, type TouchEvent } from 'react';
import { formatTime, isEmojiOnly } from '../lib/format';
import { replySwipe } from '../lib/gesture';

/** 인용문 표시용 — 원본 해석과 이름 붙이기는 ChatRoom이 미리 끝낸다 */
export interface QuoteView {
  id: number;
  name: string;
  text: string;
}

interface Props {
  message: WireMessage;
  mine: boolean;
  /** 아직 서버 확인(ack) 전인지 — 반투명 표시 */
  pending: boolean;
  /** 상대가 이 메시지까지 읽었는지 (내 메시지에만 의미 있음) */
  read: boolean;
  /** 연속 메시지 묶음의 마지막인지 (꼬리/시간 표시) */
  isTail: boolean;
  /** 이 메시지가 인용하는 원본 (해석 실패 시 undefined) */
  quote?: QuoteView;
  /** 점프해 온 직후인지 — 잠깐 배경을 밝힌다 */
  highlighted: boolean;
  onImageClick: (message: WireMessage) => void;
  onReply: (message: WireMessage) => void;
  onQuoteClick: (messageId: number) => void;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  mine,
  pending,
  read,
  isTail,
  quote,
  highlighted,
  onImageClick,
  onReply,
  onQuoteClick,
}: Props) {
  const emojiOnly = message.k === 'e' || (message.k === 't' && isEmojiOnly(message.x));
  const [offset, setOffset] = useState(0);
  // 터치 시작점 — 재렌더를 유발하지 않도록 ref에 둔다.
  const start = useRef<{ x: number; y: number } | null>(null);

  // 아직 서버 확인 전(음수 id)인 메시지는 답장 대상이 될 수 없다 — 서버가 400을 준다.
  const canReply = message.id > 0;

  function onTouchStart(event: TouchEvent<HTMLDivElement>) {
    if (!canReply) return;
    const touch = event.touches[0]!;
    start.current = { x: touch.clientX, y: touch.clientY };
  }

  function onTouchMove(event: TouchEvent<HTMLDivElement>) {
    if (!start.current) return;
    const touch = event.touches[0]!;
    const { offset: next } = replySwipe(
      touch.clientX - start.current.x,
      touch.clientY - start.current.y,
      mine,
    );
    setOffset(next);
  }

  function onTouchEnd(event: TouchEvent<HTMLDivElement>) {
    if (!start.current) return;
    const touch = event.changedTouches[0]!;
    const { ready } = replySwipe(
      touch.clientX - start.current.x,
      touch.clientY - start.current.y,
      mine,
    );
    start.current = null;
    setOffset(0);
    if (ready) {
      navigator.vibrate?.(10);
      onReply(message);
    }
  }

  return (
    <div
      data-message-id={message.id}
      className={`group relative flex px-3 ${mine ? 'justify-end' : 'justify-start'} ${
        isTail ? 'mb-2' : 'mb-0.5'
      } ${highlighted ? 'rounded-lg bg-primary-soft/20 transition-colors duration-500' : ''}`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* 스와이프하면 뒤에서 드러나는 답장 아이콘 */}
      {offset !== 0 && (
        <span
          aria-hidden
          className={`absolute top-1/2 -translate-y-1/2 text-ink-mute ${mine ? 'right-2' : 'left-2'}`}
        >
          ↩
        </span>
      )}

      <m.div
        // 아래에서 살짝 튀어오르는 스프링 등장 (iMessage 느낌)
        initial={{ opacity: 0, y: 14, scale: 0.9 }}
        animate={{ opacity: pending ? 0.6 : 1, y: 0, scale: 1, x: offset }}
        transition={{ type: 'spring', stiffness: 500, damping: 32, mass: 0.7 }}
        className={`flex max-w-[75%] items-end gap-1.5 ${mine ? 'flex-row-reverse' : ''}`}
      >
        <div className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
          {/* 인용문 — 원본을 못 찾으면 플레이스홀더를 보여준다 */}
          {message.r !== undefined && (
            <button
              type="button"
              onClick={() => onQuoteClick(message.r!)}
              className="mb-0.5 flex max-w-full items-center gap-1.5 rounded-md border-l-2 border-primary-soft bg-canvas-soft px-2 py-1 text-left"
            >
              <span className="shrink-0 text-[11px] font-medium text-primary-soft">
                {quote?.name ?? ''}
              </span>
              <span className="truncate text-[11px] text-ink-mute">{quote?.text ?? '메시지'}</span>
            </button>
          )}

          {message.k === 'i' && message.im ? (
            // 이미지 메시지 — 저화질 webp 미리보기
            <button
              onClick={() => onImageClick(message)}
              className="block overflow-hidden rounded-2xl"
            >
              <img
                src={`/img/${message.im.id}/thumb`}
                width={message.im.w}
                height={message.im.h}
                alt="사진"
                loading="lazy"
                className="max-h-72 w-auto max-w-full rounded-2xl object-cover"
              />
            </button>
          ) : emojiOnly ? (
            // 이모지 전용 — 말풍선 없이 크게
            <span className="px-1 text-5xl leading-tight">{message.x}</span>
          ) : (
            <div
              className={`rounded-2xl px-3.5 py-2 text-[15px] leading-snug whitespace-pre-wrap break-words ${
                mine
                  ? `bg-bubble-me text-white ${isTail ? 'rounded-br-md' : ''}`
                  : `bg-bubble-peer text-ink ${isTail ? 'rounded-bl-md' : ''}`
              }`}
            >
              {message.x}
            </div>
          )}
        </div>

        {/* 시간 + 읽음 표시 (묶음 마지막에만) */}
        {isTail && (
          <span className="tnum mb-0.5 shrink-0 text-[10px] text-ink-mute">
            {mine && read && <span className="block text-right text-primary-soft">읽음</span>}
            {formatTime(message.ts)}
          </span>
        )}

        {/* 데스크톱 답장 버튼 — 호버 또는 키보드 포커스에서 나타난다 */}
        {canReply && (
          <button
            type="button"
            onClick={() => onReply(message)}
            aria-label="이 메시지에 답장"
            className="mb-0.5 hidden size-7 shrink-0 items-center justify-center rounded-full text-ink-mute opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 hover:bg-canvas-soft md:flex"
          >
            ↩
          </button>
        )}
      </m.div>
    </div>
  );
});
```

- [ ] **Step 2: `ChatRoom.tsx` — 상태·해석·점프 추가**

import에 추가:

```tsx
import { loadOlderMessages, markRead, sendMessage, useConversations, useMessages, getQuote } from '../data';
import { isEmojiOnly, quoteText } from '../lib/format';
import { MessageBubble, type QuoteView } from '../components/MessageBubble';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
```

`const [showWebcam, setShowWebcam] = useState(false);` 아래에 상태 추가:

```tsx
  /** 지금 답장 중인 메시지 (없으면 null) */
  const [replyTo, setReplyTo] = useState<WireMessage | null>(null);
  /** 점프 직후 잠깐 밝힐 메시지 ID */
  const [highlighted, setHighlighted] = useState<number | null>(null);
```

`stickToBottom` 선언 근처(다른 상수들 옆)에 추가:

```tsx
  /** 인용 원본을 찾으러 과거로 되짚을 최대 페이지 수 — 저속 회선에서 왕복이 무한정 늘지 않게 한다 */
  const MAX_JUMP_PAGES = 10;
```

`const lastId = messages?.at(-1)?.id;` 아래에 인용 해석 메모 추가:

```tsx
  /**
   * 인용 원본 해석: ① 로드된 메시지 → ② refs 캐시 → ③ (못 찾으면 맵에 없음 = 플레이스홀더)
   * 말풍선이 memo되어 있으므로 렌더마다 새 객체를 만들지 않도록 여기서 한 번만 만든다.
   */
  const quotes = useMemo(() => {
    const byId = new Map(messages?.map((message) => [message.id, message]));
    const views = new Map<number, QuoteView>();
    for (const message of messages ?? []) {
      if (message.r === undefined || views.has(message.r)) continue;
      const local = byId.get(message.r);
      const source = local ?? getQuote(convId, message.r);
      if (!source) continue;
      views.set(message.r, {
        id: message.r,
        name: source.s === me?.id ? '나' : (conversation?.peer.nickname ?? '상대'),
        text: quoteText(source.k, source.x),
      });
    }
    return views;
  }, [messages, convId, me?.id, conversation?.peer.nickname]);
```

`scrollToLatest` 아래에 점프 함수 추가:

```tsx
  /**
   * 인용 원본으로 이동한다.
   * 로드된 범위에 없으면 과거 페이지를 되짚어 불러오되, MAX_JUMP_PAGES에서 멈춘다.
   */
  async function jumpTo(messageId: number): Promise<void> {
    for (let page = 0; page <= MAX_JUMP_PAGES; page += 1) {
      const loaded = queryClient.getQueryData<WireMessage[]>(['messages', convId]);
      if (loaded?.some((message) => message.id === messageId)) {
        stickToBottom.current = false;
        setHighlighted(messageId);
        window.setTimeout(
          () => setHighlighted((current) => (current === messageId ? null : current)),
          1200,
        );
        // 방금 불러온 페이지가 DOM에 반영된 다음 프레임에 스크롤한다.
        requestAnimationFrame(() => {
          listRef.current
            ?.querySelector(`[data-message-id="${messageId}"]`)
            ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        });
        return;
      }
      if (page === MAX_JUMP_PAGES) break;
      try {
        if (!(await loadOlderMessages(queryClient, convId))) break;
      } catch (cause) {
        setError(errorMessage(cause));
        return;
      }
    }
    setError('원본 메시지를 찾을 수 없습니다');
  }
```

- [ ] **Step 3: 전송과 단축키 배선**

`submit()`을 교체:

```tsx
  /** 텍스트/이모지 전송 */
  async function submit() {
    const text = draft.trim();
    if (!text || !me) return;
    const replyId = replyTo?.id;
    setDraft('');
    setShowEmoji(false);
    try {
      await sendMessage(queryClient, me.id, convId, isEmojiOnly(text) ? 'e' : 't', text, replyId);
      setReplyTo(null); // 성공했을 때만 해제한다 (실패 시 답장 대상을 유지)
    } catch (err) {
      setError(errorMessage(err));
      setDraft(text); // 실패하면 입력을 복구한다.
    }
  }
```

Esc 핸들러 `useEffect`를 교체:

```tsx
  // Esc → 답장 취소가 우선, 답장 중이 아니면 목록으로
  // Ctrl/Cmd + ↑ → 마지막 메시지에 답장 (입력창에 포커스가 있어도 안전한 조합)
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (replyTo) {
          setReplyTo(null);
          return;
        }
        navigate('/');
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowUp') {
        const last = messages?.at(-1);
        if (last && last.id > 0) {
          e.preventDefault();
          setReplyTo(last);
          inputRef.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, replyTo, messages]);
```

- [ ] **Step 4: 말풍선 렌더에 새 props 전달**

`messages?.map(...)` 안의 `<MessageBubble ... />`를 교체:

```tsx
                <MessageBubble
                  key={message.id}
                  message={message}
                  mine={mine}
                  pending={message.id < 0}
                  read={mine && (conversation?.peerRead ?? 0) >= message.id && message.id > 0}
                  isTail={isTail}
                  quote={message.r !== undefined ? quotes.get(message.r) : undefined}
                  highlighted={highlighted === message.id}
                  onImageClick={setViewing}
                  onReply={setReplyTo}
                  onQuoteClick={(id) => void jumpTo(id)}
                />
```

- [ ] **Step 5: 답장 바 추가**

입력 바 컨테이너(`<div className="pb-safe border-t border-hairline bg-white">`) 바로 안쪽, `<div className="mx-auto flex ...">` **앞**에 추가:

```tsx
        <AnimatePresence>
          {replyTo && (
            <m.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mx-auto w-full max-w-3xl overflow-hidden"
            >
              <div className="mx-2 mt-2 flex items-center gap-2 rounded-lg border-l-2 border-primary-soft bg-canvas-soft px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium text-primary-soft">
                    {replyTo.s === me?.id ? '나' : (conversation?.peer.nickname ?? '상대')}에게 답장
                  </p>
                  <p className="truncate text-xs text-ink-mute">
                    {quoteText(replyTo.k, replyTo.x)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReplyTo(null)}
                  aria-label="답장 취소"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-mute hover:bg-white"
                >
                  ✕
                </button>
              </div>
            </m.div>
          )}
        </AnimatePresence>
```

- [ ] **Step 6: 타입 검사와 빌드(예산 확인)**

Run: `cd /home/coder/projects/litechat && bun run check-types && cd apps/web && bun run build`
Expected: 타입 오류 없음, 빌드가 128 KB 예산을 통과

- [ ] **Step 7: 브라우저로 실제 확인**

전역 CLAUDE.md의 브라우저 검증 규칙을 따른다. 서버(`cd apps/server && REDIS_URL=memory bun run dev`)와 web dev 서버(`cd apps/web && bun run dev`)를 백그라운드로 띄우고 `agent-browser skills get core`를 먼저 읽은 뒤:
두 사용자를 만들어 친구를 맺고, 데스크톱 폭에서 ↩ 버튼으로 답장 → 인용문 표시 → 인용문 클릭 시 원본으로 스크롤되는지 확인한다.
모바일 폭(390px)으로 리사이즈해 스와이프도 확인한다. `console`과 `errors`를 확인하고 세션을 닫는다.

- [ ] **Step 8: 커밋**

```bash
git add apps/web/src
git commit -m "feat(web): 답장 UI — 인용문, 답장 바, 스와이프, Ctrl+↑ 단축키, 원본 점프"
```

---

### Task 8: app(Expo) — 데이터 계층 + 답장 UI

**Files:**
- Modify: `apps/app/src/data/data.ts` (web의 Task 6과 동일한 변경)
- Modify: `apps/app/src/lib/format.ts` (web과 동일한 `quoteText`)
- Modify: `apps/app/src/components/message-bubble.tsx`
- Modify: `apps/app/src/components/message-list.tsx`
- Modify: `apps/app/src/components/chat-room-view.tsx`
- Modify: `apps/app/src/components/composer.tsx`
- Test: `apps/app/src/components/__tests__/message-bubble.test.tsx`

**Interfaces:**
- Consumes: Task 5 `replySwipe`, Task 4의 `{ messages, refs? }`
- Produces: `MessageBubble`에 `quote?: QuoteView`, `highlighted: boolean`, `onReply`, `onQuotePress` 추가.
  `Composer`에 `replyPreview?: { name: string; text: string }`, `onCancelReply: () => void` 추가.

**Note:** `apps/app/AGENTS.md`는 코드를 쓰기 전에 https://docs.expo.dev/versions/v57.0.0/ 의 해당 API 문서를 읽으라고 지시한다. 이 태스크는 `react-native-gesture-handler`의 `Gesture.Pan`/`Gesture.Race`와 `reanimated`의 `useSharedValue`/`useAnimatedStyle`, `FlashList`의 `scrollToIndex`를 쓰므로 **Step 1에서 해당 문서를 먼저 확인한다.**

- [ ] **Step 1: Expo 57 문서 확인**

`apps/app/AGENTS.md` 지시에 따라 https://docs.expo.dev/versions/v57.0.0/ 에서 gesture-handler / reanimated 항목을 확인하고, Context7(`resolve-library-id` → `query-docs`)로 `react-native-gesture-handler`의 `Gesture.Pan` 구성(`activeOffsetX`, `failOffsetY`, `Gesture.Race`)과 `@shopify/flash-list` v2의 `scrollToIndex` 시그니처를 확인한다. 확인한 내용과 실제 설치 버전(gesture-handler 2.32, reanimated 4.5.1, flash-list 2.0.2)이 어긋나면 그 차이에 맞춰 이 태스크의 코드를 조정한다.

- [ ] **Step 2: 데이터 계층 — web과 동일하게 수정**

`apps/app/src/data/data.ts`에 Task 6의 Step 2~4를 **그대로** 적용한다 (두 파일은 import 경로와 주석만 다르고 로직은 동일하다). `cacheQuotes` / `getQuote`를 추가하고, `useMessages`·`catchUpMessages`·`loadOlderMessages` 세 곳에서 `refs`를 캐시에 넣고, `sendMessage`에 `replyTo?` 여섯 번째 인자를 더한다.

`apps/app/src/lib/format.ts`에는 Task 6 Step 1의 `quoteText`를 동일하게 추가한다.

- [ ] **Step 3: 말풍선 인용 렌더 테스트 작성**

`apps/app/src/components/__tests__/message-bubble.test.tsx`의 `base` 객체에 새 필수 props를 더한다:

```ts
const base = {
  mine: true,
  pending: false,
  read: false,
  isTail: true,
  animate: false,
  highlighted: false,
  onImagePress: jest.fn(),
  onReply: jest.fn(),
  onQuotePress: jest.fn(),
};
```

그리고 describe 안에 추가:

```tsx
  test('인용문이 있으면 보낸이와 본문을 함께 보여준다', async () => {
    await render(
      <MessageBubble
        {...base}
        message={message({ r: 7 })}
        quote={{ id: 7, name: '앨리스', text: '원본입니다' }}
      />,
    );
    expect(screen.getByText('앨리스')).toBeTruthy();
    expect(screen.getByText('원본입니다')).toBeTruthy();
  });

  test('인용 원본을 못 찾으면 플레이스홀더를 보여준다', async () => {
    await render(<MessageBubble {...base} message={message({ r: 7 })} />);
    expect(screen.getByText('메시지')).toBeTruthy();
  });

  test('답장이 아니면 인용 영역이 없다', async () => {
    await render(<MessageBubble {...base} message={message()} />);
    expect(screen.queryByText('메시지')).toBeNull();
  });
```

- [ ] **Step 4: 테스트 실패 확인**

Run: `cd apps/app && bun run test -- message-bubble`
Expected: FAIL — `quote` prop이 없고 인용 영역이 렌더되지 않는다

- [ ] **Step 5: `message-bubble.tsx` 수정**

import 추가:

```tsx
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  runOnJS,
  type EntryAnimationsValues,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { replySwipe } from '@/lib/gesture';
import { quoteText } from '@/lib/format';
```

`Props` 앞에 타입 추가:

```tsx
/** 인용문 표시용 — 원본 해석과 이름 붙이기는 MessageList가 미리 끝낸다 */
export interface QuoteView {
  id: number;
  name: string;
  text: string;
}
```

`Props`에 추가:

```tsx
  /** 이 메시지가 인용하는 원본 (해석 실패 시 undefined) */
  quote?: QuoteView;
  /** 점프해 온 직후인지 — 잠깐 배경을 밝힌다 */
  highlighted: boolean;
  onReply: (message: WireMessage) => void;
  onQuotePress: (messageId: number) => void;
```

컴포넌트 본문 시작부에 제스처 추가:

```tsx
  const translateX = useSharedValue(0);
  // 서버 확인 전(음수 id) 메시지는 답장 대상이 될 수 없다 — 서버가 400을 준다.
  const canReply = message.id > 0;

  const fireReply = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onReply(message);
  };

  // activeOffsetX/failOffsetY로 FlashList의 세로 스크롤과 다투지 않게 한다.
  const pan = Gesture.Pan()
    .enabled(canReply)
    .activeOffsetX([-15, 15])
    .failOffsetY([-10, 10])
    .onUpdate((event) => {
      'worklet';
      translateX.value = replySwipe(event.translationX, event.translationY, mine).offset;
    })
    .onEnd((event) => {
      'worklet';
      const { ready } = replySwipe(event.translationX, event.translationY, mine);
      translateX.value = withSpring(0, { stiffness: 500, damping: 32, mass: 0.7 });
      if (ready) runOnJS(fireReply)();
    });

  // 길게 눌러 신고와는 Race로 묶어 하나만 발동하게 한다.
  const longPress = Gesture.LongPress()
    .minDuration(450)
    .onStart(() => {
      'worklet';
      if (onLongPress) runOnJS(onLongPress)(message);
    });
  const gesture = onLongPress ? Gesture.Race(pan, longPress) : pan;

  const swipeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));
```

기존 `<Animated.View entering=... style={[...]}>`를 `<GestureDetector gesture={gesture}>`로 감싸고, `style` 배열에 `swipeStyle`과 하이라이트를 더한다:

```tsx
    <GestureDetector gesture={gesture}>
      <Animated.View
        entering={animate ? springEntry : undefined}
        style={[
          styles.row,
          mine ? styles.rowMine : styles.rowPeer,
          { marginBottom: isTail ? spacing.sm : spacing.xxs },
          pending && styles.pending,
          highlighted && styles.highlighted,
          swipeStyle,
        ]}
      >
```

기존 `Pressable`의 `onLongPress` prop은 제거한다 (제스처로 옮겼다). `Pressable` 안, 이미지/이모지/말풍선 분기 **앞**에 인용 블록을 넣는다:

```tsx
        {message.r !== undefined && (
          <Pressable
            onPress={() => onQuotePress(message.r!)}
            style={styles.quote}
            accessibilityRole="button"
            accessibilityLabel="인용한 원본 메시지로 이동"
          >
            <Text style={styles.quoteName}>{quote?.name ?? ''}</Text>
            <Text style={styles.quoteText} numberOfLines={1}>
              {quote?.text ?? '메시지'}
            </Text>
          </Pressable>
        )}
```

`Pressable`의 `style`을 세로 배치로 바꾼다 (인용문이 말풍선 위에 오도록):

```tsx
      <Pressable style={[styles.group, mine && styles.groupMine]}>
```
→ 인용문을 포함하려면 `group`을 감싸는 `View`가 필요하다. `Pressable` 안을 다음 구조로 만든다:

```tsx
      <Pressable style={[styles.group, mine && styles.groupMine]}>
        <View style={mine ? styles.stackMine : styles.stack}>
          {/* 인용 블록 */}
          {/* 이미지/이모지/말풍선 분기 */}
        </View>
        {/* 시간 + 읽음 메타 */}
      </Pressable>
```

`useStyles`에 스타일 추가:

```ts
  stack: { alignItems: 'flex-start', maxWidth: '100%' },
  stackMine: { alignItems: 'flex-end', maxWidth: '100%' },
  highlighted: { backgroundColor: colors.canvasSoft, borderRadius: 12 },
  quote: {
    marginBottom: 2,
    borderLeftWidth: 2,
    borderLeftColor: colors.primarySoft,
    backgroundColor: colors.canvasSoft,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    maxWidth: '100%',
  },
  quoteName: { fontSize: 11, fontWeight: '500', color: colors.primarySoft },
  quoteText: { fontSize: 11, color: colors.inkMute },
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `cd apps/app && bun run test -- message-bubble`
Expected: PASS

- [ ] **Step 7: `message-list.tsx` — 인용 해석과 새 props 전달**

`Row`에 필드 추가:

```ts
  /** 이 메시지가 인용하는 원본 (해석 실패 시 undefined) */
  quote?: QuoteView;
  highlighted: boolean;
```

`Props`에 추가:

```ts
  /** 점프 직후 잠깐 밝힐 메시지 ID */
  highlightedId: number | null;
  onReply: (message: WireMessage) => void;
  onQuotePress: (messageId: number) => void;
```

`rows` useMemo 안에서 web의 `quotes` 메모와 같은 방식으로 인용을 해석한다. `getQuote`를 `@/data/data`에서 import하고, `conversation?.peer.nickname`과 `meId`로 이름을 붙인다. `renderItem`에 `quote`, `highlighted`, `onReply`, `onQuotePress`를 넘긴다.

- [ ] **Step 8: `chat-room-view.tsx` — 답장 상태, 점프, Composer 배선**

`replyTo`/`highlighted` state를 추가하고, `onSend`가 `replyTo?.id`를 여섯 번째 인자로 넘긴 뒤 성공 시 `setReplyTo(null)` 한다. web의 `jumpTo`와 같은 루프를 만들되 스크롤은 `listRef.current?.scrollToIndex({ index, animated: true })`로 한다 (인덱스는 `messages.findIndex((m) => m.id === messageId)`).

- [ ] **Step 9: `composer.tsx` — 답장 바**

`Props`에 `replyPreview?: { name: string; text: string }`와 `onCancelReply: () => void`를 추가하고, `<Glass>` 안 `<View style={styles.bar}>` **위**에 답장 바를 렌더한다 (이름 + 한 줄 + ✕ Pressable, 44pt 터치 타깃).

- [ ] **Step 10: 앱 테스트 전체 + 타입 검사**

Run: `cd apps/app && bun run test && bun run check-types`
Expected: PASS

- [ ] **Step 11: 커밋**

```bash
git add apps/app/src
git commit -m "feat(app): 답장 UI — 스와이프 제스처, 인용문, 답장 바, 원본 점프"
```

---

### Task 9: lite — 답장 (예산 안에서)

**Files:**
- Modify: `apps/lite/src/main.ts`
- Modify: `apps/lite/src/style.css`

**Interfaces:**
- Consumes: Task 4의 `{ messages, refs? }`
- Produces: 없음 (독립 앱)

**Note:** Lite는 `@litechat/types`에서 **런타임 값**을 import하지 않는다 — `index.ts`가 zod를 쓰는 `schemas.ts`를 재수출하므로 트리셰이킹에 기대면 10 KB 예산이 위험해진다. 따라서 `replySwipe`와 동일한 규칙을 `main.ts`에 인라인으로 다시 쓴다(세 번째 사본). 임계값 56 / 최대 72는 `apps/app/src/lib/gesture.ts`와 반드시 같은 값을 쓴다.

- [ ] **Step 1: 착수 전 기준선 측정**

Run: `cd apps/lite && bun run build`
Expected: `합계 7283B (예산 10240B)` 부근. 이 수치를 기록해 두고 마지막에 증가분을 비교한다.

- [ ] **Step 2: 상태와 인용 캐시 추가**

`main.ts`의 상태 블록(`const drafts = new Map...` 아래)에 추가:

```ts
/** 대화별 인용 원본 캐시 — /messages 응답의 refs (본문이 잘려 있어 msgs와 섞지 않는다) */
const quotes = new Map<number, Map<number, WireQuote>>();
/** 대화별 답장 대상 메시지 ID */
const replyTo = new Map<number, number>();
```

import에 `WireQuote`를 더한다 (타입 전용이라 번들에 남지 않는다):

```ts
import type { ConversationSummary, PublicUser, ServerFrame, WireMessage, WireQuote } from '@litechat/types';
```

`cellCols` 아래에 헬퍼 추가:

```ts
/** refs를 캐시에 병합한다 */
function cacheQuotes(convId: number, refs?: WireQuote[]): void {
  if (!refs?.length) return;
  let map = quotes.get(convId);
  if (!map) quotes.set(convId, (map = new Map()));
  for (const q of refs) map.set(q.id, q);
}
/** 인용 원본 해석: 로드된 메시지 → refs 캐시 (못 찾으면 null) */
function quoteOf(convId: number, id: number): { s: number; k: WireMessage['k']; x: string } | null {
  return (msgs.get(convId) ?? []).find((m) => m.id === id) ?? quotes.get(convId)?.get(id) ?? null;
}
/** 인용문 한 줄 — 이미지는 본문이 ID라 '사진'으로 바꾼다 */
const quoteText = (k: WireMessage['k'], x: string) => (k === 'i' ? '사진' : x);
```

- [ ] **Step 3: `loadMsgs`와 "이전 메시지 보기"에서 refs 수집**

`loadMsgs`를 교체:

```ts
async function loadMsgs(convId: number, after?: number): Promise<void> {
  const query = after ? `?after=${after}` : '?limit=30';
  const { messages, refs } = await req<{ messages: Msg[]; refs?: WireQuote[] }>(
    `/api/chat/${convId}/messages${query}`,
  );
  cacheQuotes(convId, refs);
  const existing = msgs.get(convId) ?? [];
  if (after) {
    msgs.set(convId, [...existing, ...messages]);
  } else {
    msgs.set(convId, messages);
    hasMore.set(convId, messages.length >= 30);
  }
}
```

`chatView`의 "이전 메시지 보기" 핸들러에서도 동일하게:

```ts
            const { messages, refs } = await req<{ messages: Msg[]; refs?: WireQuote[] }>(
              `/api/chat/${convId}/messages?before=${oldest.id}&limit=30`,
            );
            cacheQuotes(convId, refs);
```

- [ ] **Step 4: 메시지 행에 인용문·답장 버튼·식별자 추가**

`list.forEach((message) => { ... })` 안, `msgList.append(h('div', { class: ... }, ...))` 호출을 교체한다. 행에 `data-id`와 `data-mine`을 달고, 인용문 한 줄과 `↩` 버튼을 넣는다:

```ts
    const quoted = message.r !== undefined ? quoteOf(convId, message.r) : null;
    msgList.append(
      h(
        'div',
        { class: `mr${mine ? ' mine' : ''}${message._i ? ' pend' : ''}`, 'data-id': message.id },
        h(
          'span',
          {
            class: `cb${message.k === 'e' || isEmojiOnly(message.x) ? ' big' : ''}`,
            style: `--s:${cellCols(typeof body === 'string' ? body : (body.textContent ?? ''))}`,
          },
          message.r !== undefined
            ? h(
                'button',
                { class: 'qt', onclick: () => void jumpTo(convId, message.r!) },
                quoted ? `↩ ${quoteText(quoted.k, quoted.x)}` : '↩ 메시지',
              )
            : null,
          body,
        ),
        message.id > 0
          ? h('button', { class: 'rp', onclick: () => { replyTo.set(convId, message.id); render(); } }, '↩')
          : null,
        h(
          'span',
          { class: 'cc' },
          mine && message.id > 0 && message.id === lastReadMine ? '읽음 ' : null,
          fmtTime(message.ts, true),
        ),
      ),
    );
```

- [ ] **Step 5: 스와이프 위임과 점프 함수 추가**

`chatView` 안, `msgList` 생성 직후에 추가:

```ts
  // 답장 스와이프 — 행마다 리스너를 달지 않고 컨테이너 하나에 위임한다.
  // 판정 규칙은 apps/app/src/lib/gesture.ts와 동일하다 (56 / 72). 값을 바꾸면 함께 바꿀 것.
  let swRow: HTMLElement | null = null;
  let swId = 0;
  let swMine = false;
  let swX = 0;
  let swY = 0;
  /** 허용 방향 이동량 — 반대 방향이거나 세로가 뚜렷하면 0 */
  const along = (dx: number, dy: number, mine: boolean) => {
    const a = mine ? -dx : dx;
    return a > 0 && a > Math.abs(dy) * 1.5 ? Math.min(a, 72) : 0;
  };
  msgList.addEventListener('touchstart', (e) => {
    const row = (e.target as HTMLElement).closest('.mr') as HTMLElement | null;
    swId = Number(row?.dataset.id ?? 0);
    if (!row || swId <= 0) return;
    swRow = row;
    swMine = row.classList.contains('mine');
    swX = (e as TouchEvent).touches[0]!.clientX;
    swY = (e as TouchEvent).touches[0]!.clientY;
  }, { passive: true });
  msgList.addEventListener('touchmove', (e) => {
    if (!swRow) return;
    const t = (e as TouchEvent).touches[0]!;
    const d = along(t.clientX - swX, t.clientY - swY, swMine);
    swRow.style.transform = d ? `translateX(${swMine ? -d : d}px)` : '';
  }, { passive: true });
  msgList.addEventListener('touchend', (e) => {
    if (!swRow) return;
    const t = (e as TouchEvent).changedTouches[0]!;
    const ready = along(t.clientX - swX, t.clientY - swY, swMine) >= 56;
    swRow.style.transform = '';
    swRow = null;
    if (ready) {
      replyTo.set(convId, swId);
      render();
    }
  });
```

`chatView` 바깥(`showImageOverlay` 근처)에 점프 함수를 추가:

```ts
/** 인용 원본으로 이동 — 없으면 과거를 최대 10페이지까지 되짚는다 */
async function jumpTo(convId: number, id: number): Promise<void> {
  for (let page = 0; page <= 10; page += 1) {
    const row = document.querySelector(`.mr[data-id="${id}"]`) as HTMLElement | null;
    if (row) {
      row.scrollIntoView({ block: 'center' });
      row.classList.add('hl');
      setTimeout(() => row.classList.remove('hl'), 1200);
      return;
    }
    if (page === 10 || !hasMore.get(convId)) break;
    const oldest = (msgs.get(convId) ?? []).find((m) => m.id > 0);
    if (!oldest) break;
    const { messages, refs } = await req<{ messages: Msg[]; refs?: WireQuote[] }>(
      `/api/chat/${convId}/messages?before=${oldest.id}&limit=30`,
    );
    cacheQuotes(convId, refs);
    if (messages.length === 0) break;
    msgs.set(convId, [...messages, ...(msgs.get(convId) ?? [])]);
    if (messages.length < 30) hasMore.set(convId, false);
    render();
  }
  showError('원본 메시지를 찾을 수 없습니다');
}
```

- [ ] **Step 6: 답장 바와 전송 배선**

`submit()`에서 답장 대상을 실어 보내고 성공 시 해제한다:

```ts
    const r = replyTo.get(convId);
    const optimistic: Msg = {
      id: -Date.now(), c: convId, s: me.id,
      k: isEmojiOnly(text) ? 'e' : 't', x: text,
      ts: Math.floor(Date.now() / 1000), _i: tempKey,
      ...(r !== undefined ? { r } : {}),
    };
    replyTo.delete(convId);
    ...
    if (!send({ t: 'm', c: convId, k: optimistic.k, x: text, i: tempKey, ...(r !== undefined ? { r } : {}) })) {
      void req<{ message: Msg }>(`/api/chat/${convId}/messages`, 'POST', {
        k: optimistic.k, x: text, ...(r !== undefined ? { r } : {}),
      })
```

입력 바를 만드는 부분에서, 입력 바 위에 답장 바를 붙인다:

```ts
  const replyId = replyTo.get(convId);
  const replySource = replyId !== undefined ? quoteOf(convId, replyId) : null;
  const replyBar =
    replyId === undefined
      ? null
      : h(
          'div',
          { class: 'rb' },
          h('span', {}, `↩ ${replySource ? quoteText(replySource.k, replySource.x) : '메시지'}`),
          h('button', { class: 'btn2', onclick: () => { replyTo.delete(convId); render(); } }, '✕'),
        );
```
그리고 입력 바를 감싸는 컨테이너에 `replyBar`를 입력 바 앞에 넣는다.

- [ ] **Step 7: CSS 추가**

`apps/lite/src/style.css`의 `.imgbtn` 줄 근처에 추가:

```css
.qt { display: block; width: 100%; text-align: left; font-size: 9px; color: #555; border-left: 2px solid #0563c1; padding-left: 4px; margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rp { flex: 0 0 auto; padding: 0 4px; font-size: 10px; color: #0563c1; }
.rb { display: flex; align-items: center; gap: 4px; padding: 2px 6px; font-size: 10px; border-top: 1px solid #d4d4d4; background: #f3f3f3; }
.rb span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mr.hl { background: #fff6cc; }
```

- [ ] **Step 8: 빌드로 예산 확인**

Run: `cd apps/lite && bun run build`
Expected: `✅ 예산 통과`. 합계가 10240 B를 넘으면 `.rp` 버튼(데스크톱 답장 진입)만 남기고 스와이프 위임 코드를 덜어내는 축소안을 검토하고, 그 판단을 사용자에게 보고한 뒤 진행한다.

- [ ] **Step 9: 타입 검사**

Run: `cd /home/coder/projects/litechat && bun run check-types`
Expected: 오류 없음

- [ ] **Step 10: 커밋**

```bash
git add apps/lite/src
git commit -m "feat(lite): 답장 — 인용 한 줄, 스와이프 위임, 원본 점프"
```

---

### Task 10: e2e + 문서

**Files:**
- Modify: `e2e/tests/web.spec.ts`
- Modify: `e2e/tests/lite.spec.ts`
- Modify: `README.md` (실시간 프로토콜 설명)

- [ ] **Step 1: web e2e에 답장 흐름 추가**

기존 전체 여정 테스트의 이미지 검증 뒤에 이어 붙인다 (alice/bob 페이지가 살아 있는 지점):

```ts
  // ── 답장: bob이 alice의 첫 메시지에 답장하면 인용문이 양쪽에 보인다
  const aliceBubble = bob.locator('[data-message-id]').filter({ hasText: '안녕 바비!' }).first();
  await aliceBubble.hover();
  await aliceBubble.getByRole('button', { name: '이 메시지에 답장' }).click();
  await expect(bob.getByText('앨리스에게 답장')).toBeVisible();
  await bob.getByPlaceholder('메시지 보내기').fill('응 안녕!');
  await bob.getByPlaceholder('메시지 보내기').press('Enter');

  // 보낸 쪽과 받은 쪽 모두 인용문을 본다.
  await expect(bob.getByRole('main').getByText('응 안녕!')).toBeVisible();
  await expect(alice.getByRole('main').getByText('응 안녕!')).toBeVisible();
  await expect(alice.getByRole('button', { name: /안녕 바비!/ }).first()).toBeVisible();

  // ── 인용문을 누르면 원본으로 이동한다
  await alice.getByRole('button', { name: /안녕 바비!/ }).first().click();
  await expect(alice.getByRole('main').getByText('안녕 바비!')).toBeInViewport();
```

- [ ] **Step 2: lite e2e에 답장 흐름 추가**

lite 전체 여정 테스트의 이미지 검증 뒤에 추가:

```ts
  // ── 답장: 행의 ↩ 버튼으로 답장 대상을 고르고 전송한다
  await bob.locator('.mr', { hasText: '안녕 바비!' }).first().locator('.rp').click();
  await expect(bob.locator('.rb')).toBeVisible();
  await bob.locator('textarea').fill('응 안녕!');
  await bob.locator('textarea').press('Enter');
  // 인용문이 두 화면 모두에 나타난다.
  await expect(bob.locator('.qt').first()).toContainText('안녕 바비!');
  await expect(alice.locator('.qt').first()).toContainText('안녕 바비!');
```

- [ ] **Step 3: e2e 실행**

Run: `cd e2e && bun run test`
Expected: PASS.
`chromium_headless_shell-1228` 관련 오류가 나면 그것은 환경 문제이므로 `PLAYWRIGHT_CHROMIUM_PATH`로 설치된 브라우저 경로를 지정해 다시 돌린다.

- [ ] **Step 4: README의 프로토콜 설명 갱신**

`README.md`의 "실시간" 항목에 한 줄 추가:

```markdown
  답장은 메시지에 `r`(인용 대상 ID) 한 필드만 싣고, 인용문을 그리는 데 필요한데 이번
  페이지에 없는 원본만 `/messages` 응답의 `refs`에 한 번씩 담아 보낸다 — 인용 본문을
  메시지마다 중복 전송하지 않는다.
```

- [ ] **Step 5: 전체 검증**

Run: `cd /home/coder/projects/litechat && bun run check-types && bun run build && bun run test`
Expected: 전부 통과, Lite 예산 통과

- [ ] **Step 6: 커밋**

```bash
git add e2e/tests README.md
git commit -m "test(e2e): 답장 전송·인용문·원본 점프 검증"
```

---

## Self-Review

**Spec coverage** — 스펙의 각 절과 태스크 대응:

| 스펙 절 | 태스크 |
| --- | --- |
| 데이터 모델 (마이그레이션 v9→v10) | Task 2 |
| 공유 타입 (`r`, `WireQuote`, 스키마, 프로토콜) | Task 1 |
| 서버 `MessagesRepo` / `listQuotes` | Task 2 |
| 서버 `sendMessage` 답장 검증 + 라우트 | Task 3 |
| 서버 `getMessages` → `{messages, refs}` | Task 4 |
| 인용문 표시 규칙 (이미지 → '사진') | Task 6 Step 1 (`quoteText`), Task 8, Task 9 |
| 인용 원본 해석 순서 ①②③ | Task 6 (캐시), Task 7 `quotes` 메모, Task 8 Step 7, Task 9 `quoteOf` |
| 응답 형태 변경이 닿는 곳 (web/app/lite 3곳) | Task 6 Step 3, Task 8 Step 2, Task 9 Step 3 |
| 원본으로 점프 (10페이지 상한) | Task 7 `jumpTo`, Task 8 Step 8, Task 9 Step 5 |
| 스와이프 판정 순수 함수 | Task 5 (+ Task 9는 인라인 사본) |
| web UI (호버 버튼, Ctrl/Cmd+↑, Esc 우선순위) | Task 7 |
| app UI (Pan/Race, 햅틱, scrollToIndex) | Task 8 |
| lite UI (이벤트 위임, ↩ 버튼, 예산) | Task 9 |
| 테스트 (서버/프로토콜/앱/e2e) | Task 1, 2, 3, 4, 5, 8, 10 |

빠진 항목 없음.

**Type consistency** — 태스크 간 이름이 일치하는지 확인함:
`replySwipe(dx, dy, mine) → { offset, ready }`, `REPLY_SWIPE_THRESHOLD/MAX`,
`cacheQuotes(convId, refs)`, `getQuote(convId, id)`, `quoteText(kind, content)`,
`QuoteView { id, name, text }`, `MessagesRepo.listQuotes(conversationId, ids)`,
`sendMessage(..., replyTo?)`가 여섯 번째 인자.
`ChatService.sendMessage`의 `replyToId`도 여섯 번째(= `excludeSocket` 뒤)로 통일했다.

**스펙과 달라진 점 1건** — 스펙은 `replySwipe` 사본이 web/app 둘이라고 적었으나, Lite가 `@litechat/types`에서 런타임 값을 import하면 zod가 번들에 딸려올 위험이 있어 Task 9에서 같은 규칙을 인라인으로 다시 쓴다(사본 3개). 스펙의 "한계" 절에 이 내용을 반영한다.
