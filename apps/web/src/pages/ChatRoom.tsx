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
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api, errorMessage, unwrap } from '../api';
import { useAuth } from '../auth';
import { loadOlderMessages, markRead, sendMessage, useConversations, useMessages } from '../data';
import { EmojiPicker } from '../components/EmojiPicker';
import { ImageViewer } from '../components/ImageViewer';
import { WebcamCapture } from '../components/WebcamCapture';
import { MessageBubble } from '../components/MessageBubble';
import { Icon } from '../components/Icon';
import { isEmojiOnly } from '../lib/format';

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

  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const loadingOlder = useRef(false);
  const olderMessagesExhausted = useRef(false);
  const [awayFromBottom, setAwayFromBottom] = useState(false);

  // 새 메시지가 오면 (하단에 붙어 있을 때) 자동 스크롤
  const lastId = messages?.at(-1)?.id;
  useEffect(() => {
    if (stickToBottom.current) {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    }
  }, [lastId]);

  // 화면에 보이는 마지막 메시지를 읽음 처리한다 (문서가 보일 때만).
  useEffect(() => {
    if (!messages || document.visibilityState !== 'visible') return;
    const lastIncoming = [...messages].reverse().find((m) => m.s !== me?.id && m.id > 0);
    if (lastIncoming) markRead(queryClient, convId, lastIncoming.id);
  }, [lastId, convId, me?.id, messages, queryClient]);

  // Esc → 목록으로
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') navigate('/');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

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

  /** 텍스트/이모지 전송 */
  async function submit() {
    const text = draft.trim();
    if (!text || !me) return;
    setDraft('');
    setShowEmoji(false);
    try {
      await sendMessage(queryClient, me.id, convId, isEmojiOnly(text) ? 'e' : 't', text);
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
                  onImageClick={setViewing}
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
            <motion.button
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
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden px-4 py-1 text-center text-xs text-ruby"
            onClick={() => setError('')}
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      {/* 입력 바 */}
      <div className="pb-safe border-t border-hairline bg-white">
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
                  <motion.div
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
                  </motion.div>
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
          <motion.button
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
          </motion.button>
        </div>
        <AnimatePresence initial={false}>
          {showEmoji && (
            <motion.div
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
            </motion.div>
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
