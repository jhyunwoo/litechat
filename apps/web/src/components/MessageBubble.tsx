/**
 * 메시지 말풍선 — iMessage 스타일 스프링 등장 애니메이션
 *
 * - 내 메시지: 파란 말풍선, 오른쪽 정렬
 * - 상대 메시지: 회색 말풍선, 왼쪽 정렬
 * - 이모지 전용 메시지: 말풍선 없이 크게 표시
 * - 이미지: 저화질 webp 표시, 탭하면 뷰어 열기
 * - 답장: 말풍선 위에 인용 한 줄. 모바일은 스와이프(상대 →, 내 것 ←),
 *   데스크톱은 호버/포커스로 나타나는 ↩ 버튼으로 답장 대상을 고른다.
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
      } ${highlighted ? 'rounded-lg bg-canvas-soft transition-colors duration-500' : ''}`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* 스와이프하면 뒤에서 드러나는 답장 아이콘 */}
      {offset !== 0 && (
        <span
          aria-hidden
          className={`absolute top-1/2 -translate-y-1/2 text-ink-mute ${
            mine ? 'right-2' : 'left-2'
          }`}
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
        <div className={`flex min-w-0 flex-col ${mine ? 'items-end' : 'items-start'}`}>
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
            className="mb-0.5 hidden size-7 shrink-0 items-center justify-center rounded-full text-ink-mute opacity-0 transition group-hover:opacity-100 hover:bg-canvas-soft focus-visible:opacity-100 md:flex"
          >
            ↩
          </button>
        )}
      </m.div>
    </div>
  );
});
