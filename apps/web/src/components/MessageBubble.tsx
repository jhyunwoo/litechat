/**
 * 메시지 말풍선 — iMessage 스타일 스프링 등장 애니메이션
 *
 * - 내 메시지: 파란 말풍선, 오른쪽 정렬
 * - 상대 메시지: 회색 말풍선, 왼쪽 정렬
 * - 이모지 전용 메시지: 말풍선 없이 크게 표시
 * - 이미지: 저화질 webp 표시, 탭하면 뷰어 열기
 */
import type { WireMessage } from '@litechat/types';
import { m } from 'motion/react';
import { memo } from 'react';
import { formatTime, isEmojiOnly } from '../lib/format';

interface Props {
  message: WireMessage;
  mine: boolean;
  /** 아직 서버 확인(ack) 전인지 — 반투명 표시 */
  pending: boolean;
  /** 상대가 이 메시지까지 읽었는지 (내 메시지에만 의미 있음) */
  read: boolean;
  /** 연속 메시지 묶음의 마지막인지 (꼬리/시간 표시) */
  isTail: boolean;
  onImageClick: (message: WireMessage) => void;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  mine,
  pending,
  read,
  isTail,
  onImageClick,
}: Props) {
  const emojiOnly = message.k === 'e' || (message.k === 't' && isEmojiOnly(message.x));

  return (
    <m.div
      // 아래에서 살짝 튀어오르는 스프링 등장 (iMessage 느낌)
      initial={{ opacity: 0, y: 14, scale: 0.9 }}
      animate={{ opacity: pending ? 0.6 : 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 32, mass: 0.7 }}
      className={`flex px-3 ${mine ? 'justify-end' : 'justify-start'} ${isTail ? 'mb-2' : 'mb-0.5'}`}
    >
      <div className={`flex max-w-[75%] items-end gap-1.5 ${mine ? 'flex-row-reverse' : ''}`}>
        {message.k === 'i' && message.im ? (
          // 이미지 메시지 — 저화질 webp 미리보기
          <button onClick={() => onImageClick(message)} className="block overflow-hidden rounded-2xl">
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

        {/* 시간 + 읽음 표시 (묶음 마지막에만) */}
        {isTail && (
          <span className="tnum mb-0.5 shrink-0 text-[10px] text-ink-mute">
            {mine && read && <span className="block text-right text-primary-soft">읽음</span>}
            {formatTime(message.ts)}
          </span>
        )}
      </div>
    </m.div>
  );
});
