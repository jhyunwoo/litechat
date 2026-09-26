/**
 * Lite Chat 메인 — 프레임워크 없는 초경량 SPA
 *
 * 해시 라우팅: #login #signup #chats #friends #profile #c/:id
 * 모든 화면은 #app에 직접 렌더링한다. 주석은 빌드 시 제거되므로 크기 부담이 없다.
 */
import type {
  ConversationSummary,
  PublicUser,
  ServerFrame,
  WireMessage,
  WireQuote,
} from '@litechat/types';
import { errMsg, fmtBytes, onBytesChange, req, resetBytes, totalBytes } from './net';
import { onFrame, onReconnect, send, startSocket, stopSocket } from './sock';

/* ---------- 상태 ---------- */
let me: PublicUser | null = null;
let convs: ConversationSummary[] = [];
/** 대화별 메시지 (오름차순). _i = 전송 대기 임시 키 */
type Msg = WireMessage & { _i?: string };
const msgs = new Map<number, Msg[]>();
/** 과거 메시지를 더 불러올 수 있는지 */
const hasMore = new Map<number, boolean>();
/** 대화별 작성 중 초안 — 재렌더가 textarea를 갈아치워도 입력을 보존한다 */
const drafts = new Map<number, string>();
/** 대화별 인용 원본 캐시 — /messages 응답의 refs (본문이 잘려 있어 msgs와 섞지 않는다) */
const quotes = new Map<number, Map<number, WireQuote>>();
/** 대화별 답장 대상 메시지 ID */
const replyTo = new Map<number, number>();
let friends: { user: PublicUser; c: number }[] = [];
let requests: { incoming: { id: number; user: PublicUser }[]; outgoing: { id: number; user: PublicUser }[] } = {
  incoming: [],
  outgoing: [],
};
/** 낙관적 메시지의 임시 id/전송 키 — 같은 밀리초의 연속 전송에도 겹치지 않게 단조 증가 */
let tempSeq = 0;

/** 로그아웃 시 사용자 데이터가 담긴 모듈 상태를 전부 비운다 — 계정 전환 후 이전 데이터가 남지 않게 */
function resetState(): void {
  convs = [];
  msgs.clear();
  hasMore.clear();
  drafts.clear();
  quotes.clear();
  replyTo.clear();
  friends = [];
  requests = { incoming: [], outgoing: [] };
}

const app = document.getElementById('app')!;

/* ---------- DOM 헬퍼 ---------- */
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: (Node | string | null)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) {
      el.addEventListener(key.slice(2), value as EventListener);
    } else if (value !== false && value != null) {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) if (child != null) el.append(child);
  return el;
}

/** 시간 표시 — 오늘이면 시:분, 아니면 월/일.
    withDate면 지난 날짜도 시각까지 붙인다 (메시지 행 전용).
    시간 열은 한 칸(64px)뿐이라 넘치면 잘린다 — 날짜를 같이 쓸 땐 오전/오후 없이 24시간제로 폭을 아낀다 */
function fmtTime(ts: number, withDate = false): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  if (!withDate) return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
  const hm = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

const isEmojiOnly = (s: string) =>
  /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*){1,3}$/u.test(
    s.trim(),
  );

/** 메시지 셀이 차지할 열 수 — 폭 실측이 불가하니 글자 폭(한글·이모지 2 / 그 외 1, 10px 기준 ≈5px)으로 어림한다.
    한 열이 모자라면 Excel 자동 줄바꿈처럼 셀 안에서 줄이 늘어난다. 마지막 열은 시간용이라 8열까지만. */
function cellCols(text: string): number {
  let units = 0;
  for (const ch of text) units += (ch.codePointAt(0) ?? 0) > 0x2e80 ? 2 : 1;
  return Math.min(8, Math.ceil((units * 5 + 16) / 64));
}

/** refs를 인용 캐시에 병합한다 */
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
/** 허용 방향 이동량 (반대 방향이거나 세로가 뚜렷하면 0) — apps/app/src/lib/gesture.ts와 같은 규칙 */
const swipeAlong = (dx: number, dy: number, mine: boolean) => {
  const a = mine ? -dx : dx;
  return a > 0 && a > Math.abs(dy) * 1.5 ? Math.min(a, 72) : 0;
};

/* ---------- 데이터 로딩 ---------- */
async function loadConvs(): Promise<void> {
  convs = (await req<{ conversations: ConversationSummary[] }>('/api/chat')).conversations;
}
async function loadFriends(): Promise<void> {
  [friends, requests] = await Promise.all([
    req<{ friends: typeof friends }>('/api/friends').then((r) => r.friends),
    req<typeof requests>('/api/friends/requests'),
  ]);
}
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

/* ---------- 실시간 프레임 처리 ---------- */
onFrame((frame: ServerFrame) => {
  if (frame.t === 'm') {
    const { t: _t, ...message } = frame;
    const list = msgs.get(message.c);
    if (list) list.push(message);
    const conv = convs.find((c) => c.id === message.c);
    if (conv) {
      conv.last = message;
      if (message.s !== me?.id) conv.unread += 1;
    } else {
      // 새 대화방 — 목록을 다시 불러온다.
      void loadConvs().then(render);
    }
    // 채팅방을 보고 있으면 즉시 읽음 처리
    const current = currentConv();
    if (current === message.c && message.s !== me?.id) {
      send({ t: 'r', c: message.c, m: message.id });
      if (conv) conv.unread = 0;
    }
    render();
  } else if (frame.t === 'a') {
    // 전송 확인: 임시 메시지를 실제 ID로 교체
    for (const list of msgs.values()) {
      const message = list.find((m) => m._i === frame.i);
      if (message) {
        message.id = frame.id;
        message.ts = frame.ts;
        if (frame.im) message.im = frame.im;
        delete message._i;
      }
    }
    render();
  } else if (frame.t === 'r') {
    const conv = convs.find((c) => c.id === frame.c);
    if (conv) conv.peerRead = frame.m;
    render();
  } else if (frame.t === 'f') {
    void Promise.all([loadFriends(), frame.k === 'acc' ? loadConvs() : null]).then(render);
  } else if (frame.t === 'e' && frame.i) {
    for (const [convId, list] of msgs) {
      msgs.set(convId, list.filter((m) => m._i !== frame.i));
    }
    showError(errMsg(new Error(frame.m)));
    render();
  }
});

// 재연결: 대화 목록 + 열린 대화의 밀린 메시지를 따라잡는다.
onReconnect(() => {
  void loadConvs().then(() => {
    const convId = currentConv();
    if (convId) {
      const last = msgs.get(convId)?.findLast((m) => m.id > 0);
      void loadMsgs(convId, last?.id ?? 0).then(render);
    } else {
      render();
    }
  });
});

/* ---------- 라우터 ---------- */
function route(): string {
  return location.hash.slice(1) || 'chats';
}
/** 현재 열린 대화방 ID (#c/123) — 아니면 null */
function currentConv(): number | null {
  const match = route().match(/^c\/(\d+)$/);
  return match ? Number(match[1]) : null;
}
function go(hash: string): void {
  location.hash = hash;
}
window.addEventListener('hashchange', () => {
  void openRoute();
});

async function openRoute(): Promise<void> {
  const convId = currentConv();
  if (convId && !msgs.has(convId)) {
    await loadMsgs(convId);
  }
  render();
  if (convId) {
    // 방에 들어오면 마지막 수신 메시지를 읽음 처리한다.
    const last = msgs.get(convId)?.findLast((m) => m.s !== me?.id && m.id > 0);
    const conv = convs.find((c) => c.id === convId);
    if (last) {
      if (!send({ t: 'r', c: convId, m: last.id })) {
        void req(`/api/chat/${convId}/read`, 'POST', { m: last.id });
      }
      if (conv) conv.unread = 0;
    }
  }
}

/* ---------- 오류 표시 ---------- */
let errorText = '';
let errorTimer = 0;
function showError(text: string): void {
  errorText = text;
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => {
    errorText = '';
    render();
  }, 3000) as unknown as number;
  render();
}

/* ---------- 화면: 인증 ---------- */
function authView(signup: boolean): HTMLElement {
  const username = h('input', { class: 'in', placeholder: '아이디', autocapitalize: 'none' });
  const nickname = h('input', { class: 'in', placeholder: '닉네임', maxlength: 20 });
  const password = h('input', { class: 'in', type: 'password', placeholder: '비밀번호 (8자+)' });

  const form = h(
    'form',
    {
      class: 'auth',
      onsubmit: (e: Event) => {
        e.preventDefault();
        void (async () => {
          try {
            const body = signup
              ? { username: username.value, password: password.value, nickname: nickname.value }
              : { username: username.value, password: password.value };
            const { user } = await req<{ user: PublicUser }>(
              `/api/auth/${signup ? 'register' : 'login'}`,
              'POST',
              body,
            );
            me = user;
            startSocket();
            await Promise.all([loadConvs(), loadFriends()]);
            go('chats');
          } catch (error) {
            showError(errMsg(error));
          }
        })();
      },
    },
    h('h1', {}, 'Excel'),
    h('p', {}, '계속하려면 로그인하세요'),
    username,
    signup ? nickname : null,
    password,
    errorText ? h('div', { class: 'err' }, errorText) : null,
    h('button', { class: 'btn', type: 'submit' }, signup ? '가입하기' : '로그인'),
    h(
      'p',
      {},
      signup ? '계정이 있나요? ' : '처음인가요? ',
      h(
        'a',
        { href: signup ? '#login' : '#signup' },
        signup ? '로그인' : '가입하기',
      ),
    ),
  );
  return form;
}

/* ---------- 화면: 셸 — Excel 크롬(제목줄/리본/시트 탭/상태줄) + 목록/대화 컬럼 ---------- */
/** A/B/C 열 머리글 행 — 목록 컬럼용(.gr 3열과 폭이 같다) */
function colHead(): HTMLElement {
  return h('div', { class: 'ch' }, h('span', {}), h('span', {}, 'A'), h('span', {}, 'B'), h('span', {}, 'C'));
}

/** 대화·빈 시트 머리글 — 균일 폭 A..T (메시지 행에 그리는 세로선과 열 경계가 일치한다) */
function sheetHead(): HTMLElement {
  return h('div', { class: 'ch cw' }, h('span', {}), ...[...'ABCDEFGHIJKLMNOPQRST'].map((c) => h('span', {}, c)));
}

function shell(section: string, body: HTMLElement, detail: HTMLElement, inChat: boolean): HTMLElement {
  const unread = convs.reduce((sum, c) => sum + c.unread, 0);
  return h(
    'div',
    { class: `layout${inChat ? ' chat' : ''}` },
    h('div', { class: 'tbar' }, h('span', { class: 'grow' }, 'message.xlsx - Excel'), h('span', {}, '—  ▢  ✕')),
    h(
      'div',
      { class: 'ribbon' },
      ...['파일', '홈', '삽입', '수식', '데이터', '보기'].map((tab) =>
        h('span', { class: tab === '홈' ? 'on' : '' }, tab),
      ),
    ),
    h(
      'div',
      { class: 'main' },
      h('aside', { class: 'listcol' }, colHead(), h('main', { class: 'grid' }, body)),
      h('main', { class: 'detailcol' }, detail),
    ),
    h(
      'nav',
      { class: 'sheets' },
      h(
        'button',
        { class: section === 'chats' ? 'on' : '', onclick: () => go('chats') },
        `채팅${unread ? ` (${unread})` : ''}`,
      ),
      h(
        'button',
        { class: section === 'friends' ? 'on' : '', onclick: () => go('friends') },
        `친구${requests.incoming.length ? ` (${requests.incoming.length})` : ''}`,
      ),
      h('button', { class: section === 'profile' ? 'on' : '', onclick: () => go('profile') }, '내정보'),
      h('span', {}, '+'),
    ),
    h(
      'div',
      { class: 'sbar' },
      h('span', { class: errorText ? 'err' : '' }, errorText || '준비'),
      h('span', { class: 'use' }, fmtBytes(totalBytes())),
    ),
  );
}

/** 데스크탑 빈 대화 컬럼 — 빈 시트처럼 보이게 (모바일에선 CSS로 숨겨진다) */
function emptyView(): HTMLElement {
  return h('div', { class: 'col' }, sheetHead(), h('div', { class: 'blank' }));
}

/* ---------- 화면: 채팅 목록 ---------- */
function chatsView(): HTMLElement {
  const list = h('div', {});
  if (convs.length === 0) {
    list.append(h('p', { class: 'stat dim' }, '친구를 추가하고 대화를 시작해 보세요'));
  }
  for (const conv of convs) {
    const previewText = !conv.last ? '대화 시작하기' : conv.last.k === 'i' ? '[사진]' : conv.last.x;
    list.append(
      h(
        'div',
        { class: `gr${conv.id === currentConv() ? ' on' : ''}`, onclick: () => go(`c/${conv.id}`) },
        h('span', { class: 'el' }, h('b', {}, conv.peer.nickname)),
        h('span', { class: 'el dim' }, previewText),
        h(
          'span',
          { class: 'cc' },
          conv.unread ? h('span', { class: 'un' }, `${conv.unread} `) : null,
          conv.last ? fmtTime(conv.last.ts) : '',
        ),
      ),
    );
  }
  return list;
}

/* ---------- 화면: 친구 ---------- */
function friendsView(): HTMLElement {
  const results = h('div', {});
  const search = h('input', {
    class: 'in',
    placeholder: '아이디로 친구 찾기',
    autocapitalize: 'none',
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === 'Enter') void doSearch();
    },
  });

  async function doSearch(): Promise<void> {
    const query = search.value.trim();
    if (!query) return;
    const { users } = await req<{ users: (PublicUser & { rel: string })[] }>(
      `/api/friends/search?q=${encodeURIComponent(query)}`,
    );
    results.replaceChildren();
    if (users.length === 0) results.append(h('p', { class: 'dim', style: 'padding:6px 2px' }, '결과 없음'));
    for (const user of users) {
      const relText: Record<string, string> = { self: '나', friends: '친구', pending_out: '요청됨', pending_in: '받은 요청' };
      results.append(
        h(
          'div',
          { class: 'gr' },
          h('span', { class: 'el' }, h('b', {}, user.nickname)),
          h('span', { class: 'el dim' }, `@${user.username}`),
          user.rel === 'none'
            ? h(
                'span',
                {},
                h(
                  'button',
                  {
                    class: 'btn2',
                    onclick: async () => {
                      try {
                        await req('/api/friends/requests', 'POST', { userId: user.id });
                        // 전체 재렌더 대신 검색 결과만 갱신한다 (검색어/포커스 유지).
                        await loadFriends();
                        await doSearch();
                      } catch (error) {
                        showError(errMsg(error));
                      }
                    },
                  },
                  '추가',
                ),
              )
            : h('span', { class: 'dim' }, relText[user.rel] ?? ''),
        ),
      );
    }
  }

  const incoming = h('div', {});
  if (requests.incoming.length) {
    incoming.append(h('p', { class: 'gh' }, '받은 요청'));
    for (const request of requests.incoming) {
      incoming.append(
        h(
          'div',
          { class: 'gr' },
          h('span', { class: 'el' }, h('b', {}, request.user.nickname)),
          h('span', { class: 'el dim' }, `@${request.user.username}`),
          h(
            'span',
            {},
            h(
              'button',
              {
                class: 'btn2 my',
                onclick: async () => {
                  await req(`/api/friends/requests/${request.id}/respond`, 'POST', { accept: true });
                  await Promise.all([loadFriends(), loadConvs()]);
                  render();
                },
              },
              '✓',
            ),
            ' ',
            h(
              'button',
              {
                class: 'btn2',
                onclick: async () => {
                  await req(`/api/friends/requests/${request.id}/respond`, 'POST', { accept: false });
                  await loadFriends();
                  render();
                },
              },
              '✕',
            ),
          ),
        ),
      );
    }
  }

  const friendList = h('div', {}, h('p', { class: 'gh' }, `친구 ${friends.length}`));
  for (const friend of friends) {
    friendList.append(
      h(
        'div',
        { class: 'gr', onclick: () => go(`c/${friend.c}`) },
        h('span', { class: 'el' }, h('b', {}, friend.user.nickname)),
        h('span', { class: 'el dim' }, `@${friend.user.username}`),
        h('span', {}),
      ),
    );
  }

  return h(
    'div',
    {},
    h('div', { class: 'pad' }, search, results),
    incoming,
    friendList,
  );
}

/* ---------- 화면: 프로필 ---------- */
function profileView(): HTMLElement {
  return h(
    'div',
    {},
    h('div', { class: 'gr' }, h('span', { class: 'dim' }, '이름'), h('span', { class: 'el' }, h('b', {}, me?.nickname ?? '')), h('span', {})),
    h('div', { class: 'gr' }, h('span', { class: 'dim' }, '아이디'), h('span', { class: 'el' }, `@${me?.username}`), h('span', {})),
    h(
      'div',
      { class: 'gr' },
      h('span', { class: 'dim' }, '사용 데이터'),
      h('span', { class: 'use' }, fmtBytes(totalBytes())),
      h('span', {}, h('button', { class: 'btn2', onclick: () => { resetBytes(); render(); } }, '초기화')),
    ),
    h(
      'div',
      { class: 'pad' },
      h(
        'button',
        {
          class: 'btn2',
          style: 'width:100%',
          onclick: async () => {
            await req('/api/auth/logout', 'POST', {});
            stopSocket();
            me = null;
            resetState();
            go('login');
          },
        },
        '로그아웃',
      ),
    ),
    h('p', { class: 'dim stat' }, '서비스 개선을 위해 접속 IP·기기 정보 등을 수집해요.'),
  );
}

/* ---------- 화면: 채팅방 ---------- */
const QUICK_EMOJIS = ['😀', '😂', '❤️', '👍', '🙏', '😭', '🎉', '✨'];
/** 재렌더 직전 포커스가 입력바 안에 있었으면, 새로 그린 입력창에 포커스를 복원한다.
    (전송 시 낙관적 렌더 + ack 렌더가 연달아 일어나도 포커스가 유지된다) */
let keepBarFocus = false;
/** IME(한글) 조합 중이면 재렌더를 미룬다 — DOM 교체가 조합 중인 글자를 날리기 때문 */
let composing = false;
let renderQueued = false;

function chatView(convId: number): HTMLElement {
  const conv = convs.find((c) => c.id === convId);
  const list = msgs.get(convId) ?? [];

  const msgList = h('div', { class: 'msgs' });

  // 답장 스와이프 — 행마다 리스너를 달지 않고 컨테이너 하나에 위임한다 (코드/리스너 수 최소).
  let swRow: HTMLElement | null = null;
  let swId = 0;
  let swMine = false;
  let swX = 0;
  let swY = 0;
  msgList.addEventListener(
    'touchstart',
    (e) => {
      const row = (e.target as HTMLElement).closest('.mr') as HTMLElement | null;
      swId = Number(row?.dataset.id ?? 0);
      if (!row || swId <= 0) return;
      swRow = row;
      swMine = row.classList.contains('mine');
      swX = (e as TouchEvent).touches[0]!.clientX;
      swY = (e as TouchEvent).touches[0]!.clientY;
    },
    { passive: true },
  );
  msgList.addEventListener(
    'touchmove',
    (e) => {
      if (!swRow) return;
      const t = (e as TouchEvent).touches[0]!;
      const d = swipeAlong(t.clientX - swX, t.clientY - swY, swMine);
      swRow.style.transform = d ? `translateX(${swMine ? -d : d}px)` : '';
    },
    { passive: true },
  );
  msgList.addEventListener('touchend', (e) => {
    if (!swRow) return;
    const t = (e as TouchEvent).changedTouches[0]!;
    const ready = swipeAlong(t.clientX - swX, t.clientY - swY, swMine) >= 56;
    swRow.style.transform = '';
    swRow = null;
    if (ready) {
      replyTo.set(convId, swId);
      render();
    }
  });

  // 과거 메시지 버튼 — 자동 로드 대신 명시적 버튼 (예상치 못한 데이터 사용 방지)
  if (hasMore.get(convId)) {
    msgList.append(
      h(
        'button',
        {
          class: 'btn2',
          style: 'display:block;margin:0 auto 8px',
          onclick: async (e: Event) => {
            const oldest = list.find((m) => m.id > 0);
            if (!oldest) return;
            const { messages, refs } = await req<{ messages: Msg[]; refs?: WireQuote[] }>(
              `/api/chat/${convId}/messages?before=${oldest.id}&limit=30`,
            );
            cacheQuotes(convId, refs);
            msgs.set(convId, [...messages, ...list]);
            if (messages.length < 30) hasMore.set(convId, false);
            render();
          },
        },
        '이전 메시지 보기',
      ),
    );
  }

  // 내 메시지 중 상대가 읽은 마지막 것에만 '읽음' 표시
  let lastReadMine = 0;
  for (const message of list) {
    if (message.s === me?.id && message.id > 0 && message.id <= (conv?.peerRead ?? 0)) {
      lastReadMine = message.id;
    }
  }

  list.forEach((message) => {
    const mine = message.s === me?.id;

    // 메시지 = 그리드 한 행: A 보낸이 / B 내용 / C 시간·읽음
    let body: string | HTMLElement = message.x;
    if (message.k === 'i' && message.im) {
      // 이미지: 크기를 보여주고 탭해야 로드한다 (데이터 절약 핵심 UX) — 하이퍼링크 셀처럼 보인다
      const image = message.im;
      body = h(
        'button',
        {
          class: 'imgbtn',
          onclick: (e: Event) => {
            const btn = e.currentTarget as HTMLElement;
            const img = h('img', { src: `/img/${image.id}/thumb?cache=private-v2`, width: image.w, height: image.h, alt: '사진' });
            img.onclick = () => showImageOverlay(image);
            btn.parentElement?.style.setProperty('--s', '8'); // 사진이 들어갈 만큼 셀을 넓힌다
            btn.replaceWith(img);
          },
        },
        `[사진 ${fmtBytes(image.tb)}] 탭해서 보기`,
      );
    }

    // 인용문 — 원본을 못 찾으면 플레이스홀더를 보여준다
    const quoted = message.r !== undefined ? quoteOf(convId, message.r) : null;

    // 상대는 왼쪽 / 내 것은 오른쪽 — 색 구분 없이 셀 위치로만 나뉜다. 셀 폭은 열 단위로 맞춘다
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
                `↩ ${quoted ? quoteText(quoted.k, quoted.x) : '메시지'}`,
              )
            : null,
          body,
        ),
        message.id > 0
          ? h(
              'button',
              {
                class: 'rp',
                title: '답장',
                onclick: () => {
                  replyTo.set(convId, message.id);
                  render();
                },
              },
              '↩',
            )
          : null,
        h(
          'span',
          { class: 'cc' },
          mine && message.id > 0 && message.id === lastReadMine ? '읽음 ' : null,
          fmtTime(message.ts, true),
        ),
      ),
    );
  });

  if (list.length === 0) msgList.append(h('p', { class: 'stat dim' }, '첫 메시지를 보내보세요'));

  // 입력 바
  const input = h('textarea', {
    rows: 1,
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        submit();
      }
    },
    oninput: () => drafts.set(convId, input.value),
    oncompositionstart: () => {
      composing = true;
    },
    oncompositionend: () => {
      composing = false;
      drafts.set(convId, input.value);
      if (renderQueued) {
        renderQueued = false;
        render();
      }
    },
  });
  input.value = drafts.get(convId) ?? '';
  const sendBtn = h('button', { class: 'send', onclick: () => submit() }, '✓');

  // 답장 바 — 답장 대상이 정해져 있을 때만 입력 바 위에 한 줄
  const replyId = replyTo.get(convId);
  const replySource = replyId !== undefined ? quoteOf(convId, replyId) : null;
  const replyBar =
    replyId === undefined
      ? null
      : h(
          'div',
          { class: 'rb' },
          h('span', {}, `↩ ${replySource ? quoteText(replySource.k, replySource.x) : '메시지'}`),
          h(
            'button',
            {
              class: 'btn2',
              onclick: () => {
                replyTo.delete(convId);
                render();
              },
            },
            '✕',
          ),
        );

  function submit(): void {
    const text = input.value.trim();
    if (!text || !me) return;
    input.value = '';
    drafts.delete(convId);
    const tempKey = `t${++tempSeq}`;
    const r = replyTo.get(convId);
    const optimistic: Msg = {
      id: -tempSeq, c: convId, s: me.id,
      k: isEmojiOnly(text) ? 'e' : 't', x: text,
      ts: Math.floor(Date.now() / 1000), _i: tempKey,
      ...(r !== undefined ? { r } : {}),
    };
    replyTo.delete(convId);
    // 대화의 메시지 배열이 아직 없으면 만들어 저장한다 — 버려진 배열에 push하면 낙관적 메시지가 사라진다
    const pendingList = msgs.get(convId);
    if (pendingList) pendingList.push(optimistic);
    else msgs.set(convId, [optimistic]);
    if (conv) conv.last = optimistic;
    if (!send({ t: 'm', c: convId, k: optimistic.k, x: text, i: tempKey, ...(r !== undefined ? { r } : {}) })) {
      // WS가 끊겨 있으면 REST로 보낸다.
      void req<{ message: Msg }>(`/api/chat/${convId}/messages`, 'POST', { k: optimistic.k, x: text, ...(r !== undefined ? { r } : {}) })
        .then(({ message }) => {
          optimistic.id = message.id;
          optimistic.ts = message.ts;
          delete optimistic._i;
          render();
        })
        .catch((error) => {
          msgs.set(convId, (msgs.get(convId) ?? []).filter((m) => m !== optimistic));
          showError(errMsg(error));
          render();
        });
    }
    render();
  }

  // 사진 전송 — 파일 선택과 웹캠 촬영이 공용으로 쓰는 업로드 경로
  const file = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  async function uploadAndSend(blob: Blob): Promise<void> {
    if (!me) return;
    try {
      const form = new FormData();
      form.append('file', blob, blob instanceof File ? blob.name : 'photo.jpg');
      const res = await fetch('/api/images', { method: 'POST', body: form });
      const { image, error } = (await res.json()) as { image?: { id: string }; error?: string };
      if (!res.ok || !image) throw new Error(error ?? 'INVALID_IMAGE');
      if (!send({ t: 'm', c: convId, k: 'i', x: image.id, i: `t${++tempSeq}` })) {
        await req(`/api/chat/${convId}/messages`, 'POST', { k: 'i', x: image.id });
        const last = msgs.get(convId)?.findLast((m) => m.id > 0);
        await loadMsgs(convId, last?.id ?? 0);
        render();
      }
    } catch (error) {
      showError(errMsg(error));
    }
  }
  file.onchange = () => {
    const picked = file.files?.[0];
    file.value = '';
    if (picked) void uploadAndSend(picked);
  };

  // 웹캠 촬영 — 노트북 카메라 프리뷰 → 캔버스 캡처 → 위 업로드 경로 재사용
  async function openCamera(): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    } catch {
      showError('카메라를 열 수 없어요');
      return;
    }
    const video = h('video', { autoplay: '', playsinline: '' });
    video.muted = true;
    video.srcObject = stream;
    const stop = () => {
      for (const track of stream.getTracks()) track.stop();
    };
    const overlay = h(
      'div',
      { class: 'ov' },
      video,
      h(
        'div',
        { style: 'display:flex;gap:10px' },
        h('button', { class: 'btn2', onclick: () => { stop(); overlay.remove(); } }, '취소'),
        h(
          'button',
          {
            class: 'btn2',
            onclick: () => {
              const canvas = h('canvas', {});
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              canvas.getContext('2d')?.drawImage(video, 0, 0);
              canvas.toBlob((blob) => { if (blob) void uploadAndSend(blob); }, 'image/jpeg', 0.9);
              stop();
              overlay.remove();
            },
          },
          '촬영',
        ),
      ),
    );
    document.body.append(overlay);
  }

  // 사진 버튼 → 파일 선택 / 웹캠 촬영 시트
  function photoMenu(): void {
    const sheet = h(
      'div',
      { class: 'ov', onclick: () => sheet.remove() },
      h(
        'div',
        { class: 'sheet', onclick: (e: Event) => e.stopPropagation() },
        h('button', { class: 'btn', onclick: () => { sheet.remove(); file.click(); } }, '파일 선택'),
        h('button', { class: 'btn2', style: 'width:100%', onclick: () => { sheet.remove(); void openCamera(); } }, '웹캠 촬영'),
      ),
    );
    document.body.append(sheet);
  }

  const view = h(
    'div',
    { class: 'col' },
    h(
      'header',
      {},
      h('button', { class: 'chat-back', onclick: () => go('chats') }, '‹'),
      h('h1', {}, conv?.peer.nickname ?? '대화'),
    ),
    sheetHead(),
    msgList,
    h(
      'div',
      { class: 'emo' },
      ...QUICK_EMOJIS.map((emoji) =>
        h('button', { onclick: () => { input.value += emoji; drafts.set(convId, input.value); input.focus(); } }, emoji),
      ),
    ),
    replyBar,
    h(
      'div',
      { class: 'bar' },
      h('span', { class: 'ref' }, `B${list.length + 1}`),
      h('span', { class: 'fx' }, 'fx'),
      file,
      input,
      sendBtn,
      h('button', { class: 'btn2', onclick: () => photoMenu() }, '사진'),
    ),
  );

  // 렌더 후 맨 아래로 스크롤 + (직전에 입력바에 있던) 포커스 복원
  requestAnimationFrame(() => {
    msgList.scrollTop = msgList.scrollHeight;
    if (keepBarFocus) {
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }
  });
  return view;
}

/** 이미지 원본 오버레이 */
/** 인용 원본으로 이동 — 로드 범위에 없으면 과거를 최대 10페이지까지 되짚는다 */
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
    const list = msgs.get(convId) ?? [];
    const oldest = list.find((m) => m.id > 0);
    if (!oldest) break;
    const { messages, refs } = await req<{ messages: Msg[]; refs?: WireQuote[] }>(
      `/api/chat/${convId}/messages?before=${oldest.id}&limit=30`,
    );
    cacheQuotes(convId, refs);
    if (messages.length === 0) break;
    msgs.set(convId, [...messages, ...list]);
    if (messages.length < 30) hasMore.set(convId, false);
    render();
  }
  showError('원본 메시지를 찾을 수 없습니다');
}

function showImageOverlay(image: NonNullable<WireMessage['im']>): void {
  const overlay = h(
    'div',
    { class: 'ov', onclick: () => overlay.remove() },
    h('img', { src: `/img/${image.id}/thumb?cache=private-v2`, alt: '사진' }),
    h(
      'div',
      { style: 'display:flex;gap:10px' },
      h('a', { href: `/img/${image.id}/thumb?cache=private-v2`, download: `litechat-${image.id}.webp` }, `저화질 저장 (${fmtBytes(image.tb)})`),
      h('a', { href: `/img/${image.id}/orig?cache=private-v2` }, `원본 저장 (${fmtBytes(image.ob)})`),
    ),
  );
  document.body.append(overlay);
}

/* ---------- 렌더 ---------- */
function render(): void {
  if (composing) {
    renderQueued = true;
    return;
  }
  const current = route();
  if (!me) {
    app.replaceChildren(current === 'signup' ? authView(true) : authView(false));
    return;
  }
  // 교체 전에 포커스가 입력바 안에 있었는지 기록 → 재렌더 후 chatView가 포커스를 복원한다.
  keepBarFocus = document.activeElement?.closest('.bar') != null;
  const convId = currentConv();
  const section = current === 'friends' ? 'friends' : current === 'profile' ? 'profile' : 'chats';
  const body = section === 'friends' ? friendsView() : section === 'profile' ? profileView() : chatsView();
  const detail = convId != null ? chatView(convId) : emptyView();
  app.replaceChildren(shell(section, body, detail, convId != null));
}

// 헤더의 사용량 카운터는 전체 재렌더 없이 텍스트만 갱신한다.
onBytesChange(() => {
  const text = fmtBytes(totalBytes());
  for (const usage of document.querySelectorAll('.use')) usage.textContent = text;
});

/* ---------- 부팅 ---------- */
void (async () => {
  try {
    const { user } = await req<{ user: PublicUser }>('/api/auth/me');
    me = user;
    startSocket();
    await Promise.all([loadConvs(), loadFriends()]);
    await openRoute();
  } catch {
    // 미로그인 — 로그인 화면으로
    if (route() !== 'signup') go('login');
    render();
  }
})();
