/**
 * 채팅 탭 — 대화 목록 (마지막 메시지 미리보기 + 안읽음 배지)
 */
import type { WireMessage } from '@litechat/types';
import { Link } from 'react-router';
import { useConversations } from '../data';
import { formatTime } from '../lib/format';

/** 마지막 메시지 미리보기 텍스트 */
function preview(last: WireMessage | null): string {
  if (!last) return '대화를 시작해 보세요';
  if (last.k === 'i') return '📷 사진';
  return last.x;
}

export default function ChatsTab() {
  const { data: conversations, isPending } = useConversations();

  return (
    <div>
      <header className="pt-safe sticky top-0 z-10 border-b border-hairline bg-white/95 backdrop-blur">
        <h1 className="px-4 py-3 display text-2xl">채팅</h1>
      </header>

      {isPending ? (
        <p className="py-16 text-center text-sm text-ink-mute">불러오는 중…</p>
      ) : conversations?.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-20 text-ink-mute">
          <span className="text-4xl">💬</span>
          <p className="text-sm">
            아직 대화가 없어요.
            <br />
            친구 탭에서 친구를 추가하고 대화를 시작해 보세요!
          </p>
        </div>
      ) : (
        <ul>
          {conversations?.map((conv) => (
            <li key={conv.id}>
              <Link
                to={`/chat/${conv.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-canvas-soft active:bg-canvas-soft"
              >
                {/* 아바타 — 닉네임 첫 글자 */}
                <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary-soft to-primary-deep text-lg font-light text-white">
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
                      <span className="min-w-5 shrink-0 rounded-full bg-ruby px-1.5 text-center tnum text-xs leading-5 font-normal text-white">
                        {conv.unread > 99 ? '99+' : conv.unread}
                      </span>
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
