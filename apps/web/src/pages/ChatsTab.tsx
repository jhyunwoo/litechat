/**
 * 채팅 탭 — 대화 목록 (마지막 메시지 미리보기 + 안읽음 배지)
 */
import type { WireMessage } from '@litechat/types';
import { m } from 'motion/react';
import { Link, useMatch } from 'react-router';
import { useConversations } from '../data';
import { formatTime } from '../lib/format';
import { Icon } from '../components/Icon';

/** 마지막 메시지 미리보기 텍스트 */
function preview(last: WireMessage | null): string {
  if (!last) return '대화를 시작해 보세요';
  if (last.k === 'i') return '📷 사진';
  return last.x;
}

export default function ChatsTab() {
  const { data: conversations, isPending } = useConversations();
  // 데스크탑 2-pane에서 현재 열려 있는 대화를 강조하기 위한 활성 id
  const activeId = Number(useMatch('/chat/:id')?.params.id);

  return (
    <div>
      <header className="pt-safe frosted sticky top-0 z-10 border-b border-hairline">
        <h1 className="px-4 py-3 display text-2xl">채팅</h1>
      </header>

      {isPending ? (
        <p className="py-16 text-center text-sm text-ink-mute">불러오는 중…</p>
      ) : conversations?.length === 0 ? (
        <m.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28 }}
          className="flex flex-col items-center gap-3 py-20 text-ink-mute"
        >
          <div className="flex size-16 items-center justify-center rounded-full bg-canvas-soft text-primary-subdued">
            <Icon name="chat" className="size-8" />
          </div>
          <p className="text-sm">
            아직 대화가 없어요.
            <br />
            친구 탭에서 친구를 추가하고 대화를 시작해 보세요!
          </p>
        </m.div>
      ) : (
        <ul>
          {conversations?.map((conv) => (
            <li key={conv.id}>
              <Link
                to={`/chat/${conv.id}`}
                className={`flex items-center gap-3 px-4 py-3 transition-colors hover:bg-canvas-soft active:bg-canvas-soft ${
                  conv.id === activeId ? 'bg-canvas-soft' : ''
                }`}
              >
                {/* 아바타 — 닉네임 첫 글자 */}
                <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-ink text-lg font-semibold text-white">
                  {conv.peer.nickname.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-normal">{conv.peer.nickname}</span>
                    {conv.last && (
                      <span className="tnum shrink-0 text-xs text-ink-mute">
                        {formatTime(conv.last.ts)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm text-ink-mute">{preview(conv.last)}</p>
                    {conv.unread > 0 && (
                      <m.span
                        key={conv.unread}
                        initial={{ scale: 0.6 }}
                        animate={{ scale: 1 }}
                        transition={{ type: 'spring', stiffness: 600, damping: 22, mass: 0.5 }}
                        className="tnum min-w-5 shrink-0 rounded-full bg-ink px-1.5 text-center text-xs leading-5 font-normal text-white"
                      >
                        {conv.unread > 99 ? '99+' : conv.unread}
                      </m.span>
                    )}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
