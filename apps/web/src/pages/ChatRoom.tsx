/**
 * 채팅방 화면
 *
 * - 메시지 목록 (위로 스크롤 시 과거 페이지 로드)
 * - 낙관적 전송 + ack 확정, 읽음 표시("읽음"), 이미지/이모지 전송
 * - Enter 전송 / Shift+Enter 줄바꿈 / Esc 뒤로가기
 * - 화면이 보이는 동안 새 메시지가 오면 자동으로 읽음 처리
 * - 입력 바의 사진/이모지/입력창/전송은 모두 44px 높이로 맞춘다 (DESIGN.md 터치 타깃)
 */
import type { WireMessage } from '@litechat/types';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, m } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api, errorMessage, unwrap } from '../api';
import { useAuth } from '../auth';
import {
  getQuote,
  loadOlderMessages,
  markRead,
  sendMessage,
  useConversations,
  useMessages,
} from '../data';
import { EmojiPicker } from '../components/EmojiPicker';
import { ImageViewer } from '../components/ImageViewer';
import { WebcamCapture } from '../components/WebcamCapture';
import { MessageBubble, type QuoteView } from '../components/MessageBubble';
import { Icon } from '../components/Icon';
import { isEmojiOnly, quoteText } from '../lib/format';

/** 인용 원본을 찾으러 과거로 되짚을 최대 페이지 수 — 저속 회선에서 왕복이 무한정 늘지 않게 한다 */
const MAX_JUMP_PAGES = 10;

export default function ChatRoom() {
  const { id } = useParams();
  const convId = Number(id);
  return <ChatRoomContent key={convId} convId={convId} />;
}

function ChatRoomContent({ convId }: { convId: number }) {
  // 실시간 동기화는 Shell 한 곳에서만 구독한다(중복 구독 시 메시지·안읽음이 2배가 됨).
  const { me } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: conversations } = useConversations();
  const conversation = conversations?.find((c) => c.id === convId);
  const { data: messages } = useMessages(convId);

  const [draft, setDraft] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [viewing, setViewing] = useState<WireMessage | null>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [showCamMenu, setShowCamMenu] = useState(false);
  const [showWebcam, setShowWebcam] = useState(false);
  /** 지금 답장 중인 메시지 (없으면 null) */
  const [replyTo, setReplyTo] = useState<WireMessage | null>(null);
  /** 점프 직후 잠깐 밝힐 메시지 ID */
  const [highlighted, setHighlighted] = useState<number | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const loadingOlder = useRef(false);
  const olderMessagesExhausted = useRef(false);
  const [awayFromBottom, setAwayFromBottom] = useState(false);

  // 새 메시지가 오면 (하단에 붙어 있을 때) 자동 스크롤
  const lastId = messages?.at(-1)?.id;

  /**
   * 인용 원본 해석: ① 로드된 메시지 → ② refs 캐시 → ③ 못 찾으면 맵에 없음(=플레이스홀더)
   * 말풍선이 memo되어 있으므로 렌더마다 새 객체를 만들지 않도록 여기서 한 번만 만든다.
   */
  const quotes = useMemo(() => {
    const byId = new Map((messages ?? []).map((message) => [message.id, message]));
    const views = new Map<number, QuoteView>();
    for (const message of messages ?? []) {
      if (message.r === undefined || views.has(message.r)) continue;
      const source = byId.get(message.r) ?? getQuote(convId, message.r);
      if (!source) continue;
      views.set(message.r, {
        id: message.r,
        name: source.s === me?.id ? '나' : (conversation?.peer.nickname ?? '상대'),
        text: quoteText(source.k, source.x),
      });
    }
    return views;
  }, [messages, convId, me?.id, conversation?.peer.nickname]);
  useEffect(() => {
    if (stickToBottom.current) {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    }
  }, [lastId]);

  // 화면에 보이는 마지막 메시지를 읽음 처리한다 (문서가 보일 때만).
  // 배열을 복사·역순 정렬하지 않고 뒤에서부터 찾는다 — 메시지가 도착할 때마다
  // 실행되는 경로라, 히스토리가 길수록 복사 비용이 그대로 프레임 예산을 깎는다.
  useEffect(() => {
    if (!messages || document.visibilityState !== 'visible') return;
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]!;
      if (message.s !== me?.id && message.id > 0) {
        markRead(queryClient, convId, message.id);
        break;
      }
    }
  }, [lastId, convId, me?.id, messages, queryClient]);

  // Esc → 답장 중이면 답장 취소가 우선, 아니면 목록으로 (한 번 더 누르면 나간다)
  // Ctrl/Cmd + ↑ → 마지막 메시지에 답장. 입력창이 거의 항상 포커스를 갖고 있어
  // 단일 문자 단축키는 글자 입력과 구분되지 않으므로 조합키를 쓴다.
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

  /** 위로 스크롤 시 과거 메시지 로드 */
  async function onScroll() {
    const el = listRef.current;
    if (!el) return;
    const isAwayFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight >= 80;
    stickToBottom.current = !isAwayFromBottom;
    setAwayFromBottom(isAwayFromBottom);
    if (
      el.scrollTop < 60 &&
      messages &&
      messages.length >= 30 &&
      !loadingOlder.current &&
      !olderMessagesExhausted.current
    ) {
      loadingOlder.current = true;
      const prevHeight = el.scrollHeight;
      try {
        const loaded = await loadOlderMessages(queryClient, convId);
        if (loaded) {
          // 스크롤 위치를 유지한다 (내용이 위로 늘어난 만큼 보정).
          requestAnimationFrame(() => {
            el.scrollTop += el.scrollHeight - prevHeight;
          });
        } else {
          olderMessagesExhausted.current = true;
        }
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        loadingOlder.current = false;
      }
    }
  }

  function scrollToLatest() {
    stickToBottom.current = true;
    const el = listRef.current;
    el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }

  /**
   * 메시지가 DOM에 나타나면 화면 가운데로 스크롤한다.
   *
   * 캐시에 메시지가 들어간 시점과 React가 그것을 커밋하는 시점은 다르다. 한 프레임만
   * 기다리면 querySelector가 아직 null이라 스크롤이 조용히 건너뛰어진다(실측으로 확인).
   * 나타날 때까지 몇 프레임 되짚는다.
   */
  function scrollToMessage(messageId: number, attempts = 20): void {
    const el = listRef.current?.querySelector(`[data-message-id="${messageId}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    if (attempts > 0) requestAnimationFrame(() => scrollToMessage(messageId, attempts - 1));
  }

  /**
   * 인용 원본으로 이동한다.
   *
   * 로드된 범위에 없으면 과거 페이지를 되짚어 불러오되 MAX_JUMP_PAGES에서 멈춘다.
   * around= 같은 새 엔드포인트를 쓰지 않는 이유는 메시지 배열에 구멍이 생기면
   * 페이지네이션과 읽음 워터마크 계산이 모두 복잡해지기 때문이다.
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
        scrollToMessage(messageId);
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

  /** 텍스트/이모지 전송 */
  async function submit() {
    const text = draft.trim();
    if (!text || !me) return;
    const replyId = replyTo?.id;
    setDraft('');
    setShowEmoji(false);
    try {
      await sendMessage(queryClient, me.id, convId, isEmojiOnly(text) ? 'e' : 't', text, replyId);
      setReplyTo(null); // 성공했을 때만 해제한다 (실패하면 답장 대상을 유지)
    } catch (err) {
      setError(errorMessage(err));
      setDraft(text); // 실패하면 입력을 복구한다.
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter 전송, Shift+Enter 줄바꿈 (모바일 IME 조합 중에는 무시)
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  }

  /** 업로드 → 이미지 메시지 전송 (파일 선택·웹캠 촬영 공용) */
  async function uploadBlob(blob: Blob) {
    if (!me) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', blob, blob instanceof File ? blob.name : 'photo.jpg');
      const res = await fetch('/api/images', { method: 'POST', body: form });
      const { image } = await unwrap<{ image: { id: string } }>(res);
      await sendMessage(queryClient, me.id, convId, 'i', image.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  /** 파일 선택 → 업로드 */
  function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void uploadBlob(file);
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-white">
      {/* 헤더 */}
      <header className="frosted pt-safe border-b border-hairline">
        <div className="flex items-center gap-2 px-2 py-2">
          <button
            onClick={() => navigate('/')}
            aria-label="뒤로"
            className="flex size-11 items-center justify-center rounded-full text-primary transition active:scale-95 active:bg-canvas-soft md:hidden"
          >
            <Icon name="back" className="size-6" />
          </button>
          <div className="flex size-9 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white">
            {conversation?.peer.nickname.charAt(0) ?? '?'}
          </div>
          <div>
            <p className="leading-tight font-normal">{conversation?.peer.nickname ?? '대화'}</p>
            <p className="text-xs leading-tight text-ink-mute">@{conversation?.peer.username}</p>
          </div>
        </div>
      </header>

      {/* 메시지 목록 */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          data-testid="chat-messages"
          onScroll={() => void onScroll()}
          className="scroll-thin h-full overflow-y-auto py-3"
        >
          <div className="mx-auto w-full max-w-3xl">
            {messages?.map((message, index) => {
              const mine = message.s === me?.id;
              const next = messages[index + 1];
              // 같은 사람의 연속 메시지 묶음에서 마지막인지 (꼬리와 시간 표시는 마지막에만)
              const isTail = !next || next.s !== message.s || next.ts - message.ts > 60;
              return (
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
              );
            })}
            {messages?.length === 0 && (
              <p className="py-16 text-center text-sm text-ink-mute">
                첫 메시지를 보내 대화를 시작해 보세요 👋
              </p>
            )}
          </div>
        </div>

        <AnimatePresence>
          {awayFromBottom && (
            <m.button
              type="button"
              onClick={scrollToLatest}
              aria-label="최신 메시지로 이동"
              title="최신 메시지로 이동"
              initial={{ opacity: 0, y: 12, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.8 }}
              transition={{ type: 'spring', stiffness: 480, damping: 30, mass: 0.6 }}
              whileTap={{ scale: 0.95 }}
              className="frosted absolute right-4 bottom-4 z-10 flex size-11 items-center justify-center rounded-full border border-hairline text-xl text-ink"
            >
              <span aria-hidden>↓</span>
            </m.button>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {error && (
          <m.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden px-4 py-1 text-center text-xs text-ruby"
            onClick={() => setError('')}
          >
            {error}
          </m.p>
        )}
      </AnimatePresence>

      {/* 입력 바 */}
      <div className="pb-safe border-t border-hairline bg-white">
        {/* 답장 바 — 답장 대상이 정해져 있을 때만 */}
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

        <div className="mx-auto flex w-full max-w-3xl items-end gap-2 p-2">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickFile} />
          <div className="relative">
            <button
              onClick={() => setShowCamMenu((v) => !v)}
              disabled={uploading}
              aria-label="사진 보내기"
              className="flex size-11 items-center justify-center rounded-full text-ink-mute transition hover:text-ink-secondary active:scale-95 active:bg-canvas-soft disabled:opacity-40"
            >
              <Icon name={uploading ? 'spinner' : 'camera'} className="size-6" />
            </button>
            <AnimatePresence>
              {showCamMenu && (
                <>
                  {/* 바깥 클릭으로 닫기 */}
                  <div className="fixed inset-0 z-10" onClick={() => setShowCamMenu(false)} />
                  <m.div
                    initial={{ opacity: 0, y: 6, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.96 }}
                    transition={{ duration: 0.16, ease: [0.32, 0.72, 0, 1] }}
                    style={{ originX: 0, originY: 1 }}
                    className="absolute bottom-full left-0 z-20 mb-2 w-36 overflow-hidden rounded-xl border border-hairline bg-white"
                  >
                    <button
                      onClick={() => {
                        setShowCamMenu(false);
                        fileRef.current?.click();
                      }}
                      className="block w-full px-4 py-2.5 text-left text-sm hover:bg-canvas-soft"
                    >
                      파일 선택
                    </button>
                    <button
                      onClick={() => {
                        setShowCamMenu(false);
                        setShowWebcam(true);
                      }}
                      className="block w-full px-4 py-2.5 text-left text-sm hover:bg-canvas-soft"
                    >
                      웹캠 촬영
                    </button>
                  </m.div>
                </>
              )}
            </AnimatePresence>
          </div>
          <button
            onClick={() => setShowEmoji((v) => !v)}
            aria-label="이모지"
            aria-expanded={showEmoji}
            className={`flex size-11 items-center justify-center rounded-full transition active:scale-95 active:bg-canvas-soft ${
              showEmoji ? 'text-primary' : 'text-ink-mute hover:text-ink-secondary'
            }`}
          >
            <Icon name="smile" className="size-6" />
          </button>
          {/* 입력창 — 한 줄일 때 정확히 44px(11 + 22 + 11)로 좌우 컨트롤과 높이를 맞춘다 */}
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="메시지 보내기"
            rows={1}
            className="max-h-28 min-h-11 flex-1 resize-none rounded-[22px] bg-canvas-soft px-4 py-[11px] text-[16px] leading-[22px]"
          />
          <m.button
            onClick={() => void submit()}
            disabled={!draft.trim()}
            aria-label="전송"
            initial={false}
            // 높이 정렬이 흐트러지지 않도록 크기는 항상 1 — 활성화되는 순간에만 살짝 튀어오른다
            animate={draft.trim() ? 'ready' : 'idle'}
            variants={{
              idle: { scale: 1, opacity: 0.35 },
              ready: { scale: [1, 1.12, 1], opacity: 1 },
            }}
            transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
            whileTap={{ scale: 0.95 }}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-white"
          >
            <Icon name="send" className="size-5" />
          </m.button>
        </div>
        <AnimatePresence initial={false}>
          {showEmoji && (
            <m.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
              className="mx-auto w-full max-w-3xl overflow-hidden"
            >
              <EmojiPicker
                onPick={(emoji) => {
                  setDraft((d) => d + emoji);
                  inputRef.current?.focus();
                }}
              />
            </m.div>
          )}
        </AnimatePresence>
      </div>

      <ImageViewer message={viewing} onClose={() => setViewing(null)} />
      <WebcamCapture
        open={showWebcam}
        onClose={() => setShowWebcam(false)}
        onCapture={(blob) => {
          setShowWebcam(false);
          void uploadBlob(blob);
        }}
      />
    </div>
  );
}
