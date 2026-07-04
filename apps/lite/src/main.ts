/**
 * Lite Chat 메인 — 프레임워크 없는 초경량 SPA
 *
 * 해시 라우팅: #login #signup #chats #friends #profile #c/:id
 * 모든 화면은 #app에 직접 렌더링한다. 주석은 빌드 시 제거되므로 크기 부담이 없다.
 */
import type { ConversationSummary, PublicUser, ServerFrame, WireMessage } from '@litechat/types';
import { addBytes, errMsg, fmtBytes, onBytesChange, req, resetBytes, totalBytes } from './net';
import { onFrame, onReconnect, send, startSocket, stopSocket } from './sock';

/* ---------- 상태 ---------- */
let me: PublicUser | null = null;
let convs: ConversationSummary[] = [];
/** 대화별 메시지 (오름차순). _i = 전송 대기 임시 키 */
type Msg = WireMessage & { _i?: string };
const msgs = new Map<number, Msg[]>();
/** 과거 메시지를 더 불러올 수 있는지 */
const hasMore = new Map<number, boolean>();
let friends: { user: PublicUser; c: number }[] = [];
let requests: { incoming: { id: number; user: PublicUser }[]; outgoing: { id: number; user: PublicUser }[] } = {
  incoming: [],
  outgoing: [],
};

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

/** 시간 표시 (오늘이면 시:분, 아니면 월/일) */
function fmtTime(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

const isEmojiOnly = (s: string) =>
  /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*){1,3}$/u.test(
    s.trim(),
  );

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
  const { messages } = await req<{ messages: Msg[] }>(`/api/chat/${convId}/messages${query}`);
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
    h('h1', {}, 'LiteChat'),
    h('p', {}, '초경량 · 데이터 절약 채팅'),
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

/* ---------- 화면: 탭 공통 ---------- */
function tabsView(active: string, title: string, body: HTMLElement): HTMLElement {
  const unread = convs.reduce((sum, c) => sum + c.unread, 0);
  const usage = h('span', { id: 'use' }, fmtBytes(totalBytes()));
  const wrap = h(
    'div',
    { style: 'display:flex;flex-direction:column;height:100%' },
    h('header', {}, h('h1', {}, title), usage),
    h('main', {}, errorText ? h('div', { class: 'err' }, errorText) : null, body),
    h(
      'nav',
      {},
      h(
        'button',
        { class: active === 'chats' ? 'on' : '', onclick: () => go('chats') },
        `채팅${unread ? ` (${unread})` : ''}`,
      ),
      h(
        'button',
        { class: active === 'friends' ? 'on' : '', onclick: () => go('friends') },
        `친구${requests.incoming.length ? ` (${requests.incoming.length})` : ''}`,
      ),
      h('button', { class: active === 'profile' ? 'on' : '', onclick: () => go('profile') }, '내정보'),
    ),
  );
  return wrap;
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
        { class: 'row', onclick: () => go(`c/${conv.id}`) },
        h(
          'div',
          { class: 'grow' },
          h('div', {}, h('b', {}, conv.peer.nickname), ' ', h('span', { class: 'dim' }, conv.last ? fmtTime(conv.last.ts) : '')),
          h('div', { class: 'dim', style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, previewText),
        ),
        conv.unread ? h('span', { class: 'badge' }, String(conv.unread)) : null,
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
    if (users.length === 0) results.append(h('p', { class: 'dim', style: 'padding:8px 2px' }, '결과 없음'));
    for (const user of users) {
      const relText: Record<string, string> = { self: '나', friends: '친구', pending_out: '요청됨', pending_in: '받은 요청' };
      results.append(
        h(
          'div',
          { class: 'row', style: 'padding:8px 2px' },
          h('div', { class: 'grow' }, h('b', {}, user.nickname), ' ', h('span', { class: 'dim' }, `@${user.username}`)),
          user.rel === 'none'
            ? h(
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
                '친구 추가',
              )
            : h('span', { class: 'dim' }, relText[user.rel] ?? ''),
        ),
      );
    }
  }

  const incoming = h('div', {});
  if (requests.incoming.length) {
    incoming.append(h('p', { class: 'dim', style: 'padding:8px 14px 0' }, '받은 요청'));
    for (const request of requests.incoming) {
      incoming.append(
        h(
          'div',
          { class: 'row' },
          h('div', { class: 'grow' }, h('b', {}, request.user.nickname), ' ', h('span', { class: 'dim' }, `@${request.user.username}`)),
          h(
            'button',
            {
              class: 'btn2',
              style: 'background:#533afd;color:#fff',
              onclick: async () => {
                await req(`/api/friends/requests/${request.id}/respond`, 'POST', { accept: true });
                await Promise.all([loadFriends(), loadConvs()]);
                render();
              },
            },
            '수락',
          ),
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
            '거절',
          ),
        ),
      );
    }
  }

  const friendList = h('div', {}, h('p', { class: 'dim', style: 'padding:8px 14px 0' }, `친구 ${friends.length}`));
  for (const friend of friends) {
    friendList.append(
      h(
        'div',
        { class: 'row', onclick: () => go(`c/${friend.c}`) },
        h('div', { class: 'grow' }, h('b', {}, friend.user.nickname), ' ', h('span', { class: 'dim' }, `@${friend.user.username}`)),
      ),
    );
  }

  return h(
    'div',
    {},
    h('div', { style: 'padding:10px 14px 0' }, search, results),
    incoming,
    friendList,
  );
}

/* ---------- 화면: 프로필 ---------- */
function profileView(): HTMLElement {
  return h(
    'div',
    {},
    h('div', { class: 'stat' }, h('b', {}, me?.nickname ?? ''), h('span', { class: 'dim' }, `@${me?.username}`)),
    h(
      'div',
      { class: 'stat' },
      h('span', { class: 'dim' }, '지금까지 사용한 데이터'),
      h('b', {}, fmtBytes(totalBytes())),
      h('button', { class: 'btn2', style: 'margin-top:6px', onclick: () => { resetBytes(); render(); } }, '측정 초기화'),
    ),
    h(
      'div',
      { style: 'padding:14px' },
      h(
        'button',
        {
          class: 'btn',
          style: 'background:#ea2261',
          onclick: async () => {
            await req('/api/auth/logout', 'POST', {});
            stopSocket();
            me = null;
            go('login');
          },
        },
        '로그아웃',
      ),
    ),
  );
}

/* ---------- 화면: 채팅방 ---------- */
const QUICK_EMOJIS = ['😀', '😂', '❤️', '👍', '🙏', '😭', '🎉', '✨'];

function chatView(convId: number): HTMLElement {
  const conv = convs.find((c) => c.id === convId);
  const list = msgs.get(convId) ?? [];

  const msgList = h('div', { class: 'msgs' });

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
            const { messages } = await req<{ messages: Msg[] }>(
              `/api/chat/${convId}/messages?before=${oldest.id}&limit=30`,
            );
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

  list.forEach((message, index) => {
    const mine = message.s === me?.id;
    const next = list[index + 1];
    const isTail = !next || next.s !== message.s || next.ts - message.ts > 60;

    let body: HTMLElement;
    if (message.k === 'i' && message.im) {
      // 이미지: 크기를 보여주고 탭해야 로드한다 (데이터 절약 핵심 UX)
      const image = message.im;
      body = h(
        'button',
        {
          class: 'imgbtn',
          onclick: (e: Event) => {
            const btn = e.currentTarget as HTMLElement;
            const img = h('img', { src: `/img/${image.id}/thumb`, width: image.w, height: image.h, alt: '사진' });
            img.onclick = () => showImageOverlay(image);
            const holder = h('div', { class: 'b imgb' }, img);
            btn.replaceWith(holder);
          },
        },
        `[사진 ${fmtBytes(image.tb)}] 탭해서 보기`,
      );
    } else if (message.k === 'e' || isEmojiOnly(message.x)) {
      body = h('div', { class: 'b big' }, message.x);
    } else {
      body = h('div', { class: 'b' }, message.x);
    }

    const meta = isTail
      ? h(
          'span',
          { class: 'meta' },
          mine && message.id > 0 && message.id === lastReadMine ? h('span', { class: 'rd' }, '읽음') : null,
          fmtTime(message.ts),
        )
      : null;

    msgList.append(
      h(
        'div',
        { class: `m${mine ? ' me' : ''}${message._i ? ' pend' : ''}`, style: isTail ? 'margin-bottom:7px' : '' },
        ...(mine ? [meta, body] : [body, meta]),
      ),
    );
  });

  if (list.length === 0) msgList.append(h('p', { class: 'stat dim' }, '첫 메시지를 보내보세요'));

  // 입력 바
  const input = h('textarea', {
    rows: 1,
    placeholder: '메시지',
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        submit();
      }
    },
  });
  const sendBtn = h('button', { class: 'send', onclick: () => submit() }, '↑');

  function submit(): void {
    const text = input.value.trim();
    if (!text || !me) return;
    input.value = '';
    const tempKey = `t${Date.now()}`;
    const optimistic: Msg = {
      id: -Date.now(), c: convId, s: me.id,
      k: isEmojiOnly(text) ? 'e' : 't', x: text,
      ts: Math.floor(Date.now() / 1000), _i: tempKey,
    };
    (msgs.get(convId) ?? []).push(optimistic);
    if (conv) conv.last = optimistic;
    if (!send({ t: 'm', c: convId, k: optimistic.k, x: text, i: tempKey })) {
      // WS가 끊겨 있으면 REST로 보낸다.
      void req<{ message: Msg }>(`/api/chat/${convId}/messages`, 'POST', { k: optimistic.k, x: text })
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

  // 사진 업로드
  const file = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  file.onchange = async () => {
    const picked = file.files?.[0];
    file.value = '';
    if (!picked || !me) return;
    try {
      const form = new FormData();
      form.append('file', picked);
      const res = await fetch('/api/images', { method: 'POST', body: form });
      const { image, error } = (await res.json()) as { image?: { id: string }; error?: string };
      if (!res.ok || !image) throw new Error(error ?? 'INVALID_IMAGE');
      if (!send({ t: 'm', c: convId, k: 'i', x: image.id, i: `t${Date.now()}` })) {
        await req(`/api/chat/${convId}/messages`, 'POST', { k: 'i', x: image.id });
        const last = msgs.get(convId)?.findLast((m) => m.id > 0);
        await loadMsgs(convId, last?.id ?? 0);
        render();
      }
    } catch (error) {
      showError(errMsg(error));
    }
  };

  const view = h(
    'div',
    { style: 'display:flex;flex-direction:column;height:100%' },
    h(
      'header',
      {},
      h('button', { onclick: () => go('chats'), style: 'font-size:20px;color:#533afd;padding:0 6px' }, '‹'),
      h('h1', {}, conv?.peer.nickname ?? '대화'),
      h('span', { id: 'use' }, fmtBytes(totalBytes())),
    ),
    errorText ? h('div', { class: 'err' }, errorText) : null,
    msgList,
    h(
      'div',
      { class: 'emo' },
      ...QUICK_EMOJIS.map((emoji) =>
        h('button', { onclick: () => { input.value += emoji; input.focus(); } }, emoji),
      ),
    ),
    h('div', { class: 'bar' }, h('button', { class: 'btn2', onclick: () => file.click() }, '사진'), file, input, sendBtn),
  );

  // 렌더 후 맨 아래로 스크롤
  requestAnimationFrame(() => {
    msgList.scrollTop = msgList.scrollHeight;
  });
  return view;
}

/** 이미지 원본 오버레이 */
function showImageOverlay(image: NonNullable<WireMessage['im']>): void {
  const overlay = h(
    'div',
    { class: 'ov', onclick: () => overlay.remove() },
    h('img', { src: `/img/${image.id}/thumb`, alt: '사진' }),
    h(
      'div',
      { style: 'display:flex;gap:10px' },
      h('a', { href: `/img/${image.id}/thumb`, download: `litechat-${image.id}.webp` }, `저화질 저장 (${fmtBytes(image.tb)})`),
      h('a', { href: `/img/${image.id}/orig` }, `원본 저장 (${fmtBytes(image.ob)})`),
    ),
  );
  document.body.append(overlay);
}

/* ---------- 렌더 ---------- */
function render(): void {
  const current = route();
  if (!me) {
    app.replaceChildren(current === 'signup' ? authView(true) : authView(false));
    return;
  }
  const convId = currentConv();
  if (convId) {
    app.replaceChildren(chatView(convId));
  } else if (current === 'friends') {
    app.replaceChildren(tabsView('friends', '친구', friendsView()));
  } else if (current === 'profile') {
    app.replaceChildren(tabsView('profile', '내정보', profileView()));
  } else {
    app.replaceChildren(tabsView('chats', '채팅', chatsView()));
  }
}

// 헤더의 사용량 카운터는 전체 재렌더 없이 텍스트만 갱신한다.
onBytesChange(() => {
  const usage = document.getElementById('use');
  if (usage) usage.textContent = fmtBytes(totalBytes());
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
